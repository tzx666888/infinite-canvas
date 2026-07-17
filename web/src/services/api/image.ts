import axios from "axios";

import { buildApiUrl, resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText, buildMaskConstrainedImageEditPrompt } from "@/lib/image-reference-prompt";
import { isTokaxisGoogleImageModel, resolveTokaxisGoogleImageConfig, TOKAXIS_GOOGLE_NATIVE_SIZES, tokaxisGoogleModelForSize } from "@/lib/tokaxis-google-image";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage = AiTextMessage | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string } | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] } | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem = { type?: "message"; content?: Array<{ type?: string; text?: string }> } | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: unknown;
    images?: unknown;
    output?: unknown;
    result?: unknown;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ChatImageApiResponse = {
    choices?: Array<{
        message?: {
            content?: string | null | Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
            images?: Array<{ type?: string; image_url?: { url?: string }; url?: string }>;
        };
    }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
type RequestOptions = { signal?: AbortSignal };

const IMAGE_PROXY_HEARTBEAT_PATTERN = /^[\s\uFEFF]+|[\s\uFEFF]+$/g;
const BASE64_IMAGE_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_PIXELS = IMAGE_MAX_EDGE * IMAGE_MAX_EDGE;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map a ratio to the pixel dimension shown in the UI. Explicit 2K/4K buttons pass dimensions directly. */
function resolveSize(ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    const shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    const longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(`图像总像素需在 ${IMAGE_MIN_PIXELS} 到 ${IMAGE_MAX_PIXELS} 之间，请调整尺寸`);
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveTokaxisGoogleRequestSize(size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    if (value in TOKAXIS_GOOGLE_NATIVE_SIZES) return value;
    const dimensions = parseImageDimensions(value);
    if (!dimensions) throw new Error("Google 图像尺寸格式不支持，请使用官方比例或像素尺寸");
    const ratio = Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height);
    if (ratio > 8) throw new Error("Google 图像宽高比不能超过 8:1");
    if (dimensions.width * dimensions.height > 20_000_000 || Math.max(dimensions.width, dimensions.height) > 12288) {
        throw new Error("Google 图像尺寸超过原生 4K 上限");
    }
    return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function imageStringFromField(value: unknown, key?: string) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;
    if (/^data:image\//i.test(text)) {
        if (!/;base64,/i.test(text)) return text;
        const commaIndex = text.indexOf(",");
        if (commaIndex < 0) return text;
        return `${text.slice(0, commaIndex + 1)}${text.slice(commaIndex + 1).replace(/\s/g, "")}`;
    }
    if (/^https?:\/\//i.test(text) || /^blob:/i.test(text)) return text;
    if (["b64_json", "base64", "image_base64"].includes(key || "")) {
        return `data:image/png;base64,${text.replace(/\s/g, "")}`;
    }
    if (key === "data" && text.length > 80 && /^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 200))) {
        return `data:image/png;base64,${text.replace(/\s/g, "")}`;
    }
    return null;
}

/**
 * The canvas proxy keeps long image requests alive by writing whitespace before
 * the upstream response. Read image responses as text and normalize that
 * envelope here so a final error JSON can never be mistaken for image bytes.
 */
function parseImageResponseBody(body: unknown): ImageApiResponse {
    if (typeof body !== "string") {
        const payload = asRecord(body);
        if (!payload) throw new Error("图片服务返回格式异常，请重试");
        return payload as ImageApiResponse;
    }

    const text = body.replace(IMAGE_PROXY_HEARTBEAT_PATTERN, "");
    if (!text) throw new Error("上游超时");

    if (/^(?:data:image\/|https?:\/\/|blob:)/i.test(text)) return { data: [text] };
    if (isPlausibleBase64Image(text)) return { data: [{ b64_json: text }] };

    try {
        const payload = asRecord(JSON.parse(text));
        if (!payload) throw new Error("图片服务返回格式异常，请重试");
        return payload as ImageApiResponse;
    } catch {
        throw new Error(normalizeImageGenerationFailure(imageErrorMessage(text) || "图片服务返回格式异常，请重试"));
    }
}

function isPlausibleBase64Image(value: string) {
    const compact = value.replace(/\s/g, "");
    return compact.length >= 16 && compact.length % 4 !== 1 && BASE64_IMAGE_PATTERN.test(compact);
}

function assertUsableImageDataUrl(dataUrl: string) {
    if (/^(?:https?:\/\/|blob:)/i.test(dataUrl)) return;
    const match = dataUrl.match(/^data:image\/[^;,]+(;base64)?,([\s\S]*)$/i);
    if (!match) throw new Error("图片服务返回格式异常，请重试");

    const payload = match[2].replace(/\s/g, "");
    if (!payload) throw new Error("图片服务没有返回有效图片，请重试");
    if (!match[1]) return;
    if (!isPlausibleBase64Image(payload)) throw new Error("图片服务没有返回有效图片，请重试");

    // Decode only a tiny header: enough to reject JSON/text disguised as image
    // data without allocating the full base64 payload a second time.
    const sampleLength = Math.min(payload.length - (payload.length % 4), 128);
    if (sampleLength < 16) throw new Error("图片服务没有返回有效图片，请重试");
    try {
        const header = atob(payload.slice(0, sampleLength));
        const isPng = header.startsWith("\x89PNG\r\n\x1a\n");
        const isJpeg = header.startsWith("\xff\xd8\xff");
        const isGif = header.startsWith("GIF87a") || header.startsWith("GIF89a");
        const isWebp = header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
        const isAvif = header.slice(4, 12).includes("ftyp");
        if (!isPng && !isJpeg && !isGif && !isWebp && !isAvif) throw new Error("invalid_image_header");
    } catch {
        throw new Error("图片服务没有返回有效图片，请重试");
    }
}

function loadBrowserImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("image_load_failed"));
        image.src = src;
    });
}

async function validateDecodedImageResults(images: Array<{ id: string; dataUrl: string }>) {
    await Promise.all(
        images.map(async (image) => {
            if (!/^data:image\//i.test(image.dataUrl) || typeof document === "undefined") return;
            try {
                const decoded = await loadBrowserImage(image.dataUrl);
                if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error("invalid_image_dimensions");
            } catch {
                throw new Error("上游超时");
            }
        }),
    );
    return images;
}

function collectImageDataUrls(value: unknown, key?: string, depth = 0): string[] {
    const direct = imageStringFromField(value, key);
    if (direct) return [direct];
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectImageDataUrls(item, key, depth + 1));
    const record = asRecord(value);
    if (!record) return [];
    const images: string[] = [];
    for (const [childKey, childValue] of Object.entries(record)) {
        images.push(...collectImageDataUrls(childValue, childKey, depth + 1));
    }
    return images;
}

function parseImagePayload(payload: ImageApiResponse) {
    const upstreamError = imageErrorMessage(payload.error);
    if (upstreamError) throw new Error(normalizeImageGenerationFailure(upstreamError));
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(normalizeImageGenerationFailure(imageErrorMessage(payload.msg) || readStatusError(payload.code, "请求失败")));
    }
    const seen = new Set<string>();
    const images = collectImageDataUrls(payload)
        .filter((dataUrl) => {
            if (seen.has(dataUrl)) return false;
            seen.add(dataUrl);
            return true;
        })
        .map((dataUrl) => {
            assertUsableImageDataUrl(dataUrl);
            return { id: nanoid(), dataUrl };
        });

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function resolveChatImageDataUrl(item: unknown) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const imageUrl = record.image_url && typeof record.image_url === "object" ? (record.image_url as Record<string, unknown>).url : undefined;
    if (typeof imageUrl === "string" && imageUrl) return imageUrl;
    if (typeof record.url === "string" && record.url) return record.url;
    return null;
}

function parseChatImagePayload(payload: ChatImageApiResponse) {
    const upstreamError = imageErrorMessage(payload.error);
    if (upstreamError) throw new Error(upstreamError);
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(imageErrorMessage(payload.msg) || readStatusError(payload.code, "请求失败"));
    }
    const images =
        payload.choices
            ?.flatMap((choice) => {
                const message = choice.message;
                const directImages = message?.images?.map(resolveChatImageDataUrl) || [];
                const content = message?.content;
                const contentImages = Array.isArray(content) ? content.filter((item) => item.type === "image_url").map(resolveChatImageDataUrl) : [];
                return [...directImages, ...contentImages];
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Google 生图接口没有返回图片");
    return images;
}

function imageTargetLabel(model: string, size?: string, quality?: string) {
    const config = resolveTokaxisGoogleImageConfig(model, size, quality);
    return `native ${config.image_size}, aspect ratio ${config.aspect_ratio}`;
}

function withTokaxisGoogleImageControls(model: string, prompt: string, size?: string, quality?: string, n?: number) {
    const target = imageTargetLabel(model, size, quality);
    const qualityText = quality && quality !== "auto" ? quality : "high";
    const rules = [
        "Image generation constraints:",
        target ? `- Output must follow ${target}.` : "- Output must follow the requested aspect ratio and composition.",
        `- Render as a crisp ${qualityText}-quality final image with clean details, natural texture, no low-resolution preview look, no blur, no compression artifacts.`,
        "- Keep the user's requested layout exactly. If the prompt asks for a four-grid or collage, create one clean 2x2 image with four equal panels.",
        "- Do not add captions, labels, borders, logos, watermarks, UI, or extra text unless explicitly requested.",
    ];
    if (n && n > 1) rules.push(`- Return exactly ${n} separate images.`);
    return `${rules.join("\n")}\n\nUser prompt:\n${prompt}`;
}

async function requestTokaxisGoogleChatImages(config: AiConfig, prompt: string, references: ReferenceImage[], n: number, size?: string, quality?: string, options?: RequestOptions) {
    const imageConfig = resolveTokaxisGoogleImageConfig(config.model, size, quality);
    const requestModel = tokaxisGoogleModelForSize(config.model, imageConfig.image_size);
    const controlledPrompt = withTokaxisGoogleImageControls(requestModel, withSystemPrompt(config, prompt), size, quality, n);
    const content: AiTextMessage["content"] = [
        {
            type: "text",
            text: controlledPrompt,
        },
        ...(await Promise.all(
            references.map(async (image) => ({
                type: "image_url" as const,
                image_url: { url: await imageToDataUrl(image) },
            })),
        )),
    ];
    const response = await axios.post<ChatImageApiResponse>(
        aiApiUrl(config, "/chat/completions"),
        {
            model: requestModel,
            messages: [{ role: "user", content }],
            temperature: 0.2,
            stream: false,
            image_config: imageConfig,
            ...(quality ? { quality } : {}),
        },
        { headers: aiHeaders(config, "application/json"), signal: options?.signal },
    );
    return parseChatImagePayload(response.data);
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        const upstreamMessage = imageErrorMessage(responseData);
        if (upstreamMessage) return normalizeImageGenerationFailure(upstreamMessage);
        const code = typeof error.code === "string" ? error.code : "";
        const message = typeof error.message === "string" ? error.message : "";
        if (!error.response) {
            if (code === "ECONNABORTED" || /timeout|timed out/i.test(message)) return "上游超时";
            if (/network error|failed to fetch|load failed|connection closed|socket hang up/i.test(message)) return "上游超时";
            return normalizeImageGenerationFailure(imageErrorMessage(message) || fallback);
        }
        return normalizeImageGenerationFailure(readStatusError(error.response.status, fallback));
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return normalizeImageGenerationFailure(error instanceof Error ? error.message : fallback);
}

function normalizeImageGenerationFailure(message: string) {
    const text = message.trim();
    const lower = text.toLowerCase();
    if (/timeout|timed out|524|gateway timeout|proxy read timeout|upstream_task_timeout|图片服务连接中断|图片处理时间较长|连接已中断/.test(lower) || /超时|连接中断|处理时间较长/.test(text)) {
        return "上游超时";
    }
    return text || "生成失败";
}

function imageErrorMessage(data: unknown): string | null {
    if (!data) return null;
    if (typeof data === "string") {
        const text = data.trim();
        if (!text) return null;
        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                return imageErrorMessage(JSON.parse(text));
            } catch {
                // Keep the original text when an upstream returns malformed JSON.
            }
        }
        const compact = text
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300);
        if (/^(请求失败|生成失败|failed|error)$/i.test(compact)) return null;
        if (/request failed with status code\s+5\d\d/i.test(compact)) return "图片服务暂时繁忙，请稍后重试";
        if (/request failed with status code\s+4(?:01|03)/i.test(compact)) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
        if (/request failed with status code\s+429/i.test(compact)) return "请求被限流或额度不足，请稍后重试";
        if (/request failed|network error|failed to fetch|load failed/i.test(compact)) return "图片服务连接中断，请重新提交";
        if (/origin web server|proxy read timeout|error code 52[245]|timed? out/i.test(compact)) return "图片处理时间较长，连接已中断，请重新提交";
        if (/gpt-image-\d+ task failed|upstream_task_failed|empty_upstream_result/i.test(compact)) return "图片生成失败，上游服务暂时不可用，请稍后重试";
        if (/gpt_image_pool_request_failed|bad_upstream_response|图片服务返回异常/i.test(compact)) return "图片服务暂时繁忙，请稍后重试";
        if (/upstream_task_timeout|task timeout/i.test(compact)) return "图片处理时间较长，请稍后重试";
        return compact || null;
    }
    if (Array.isArray(data)) {
        for (const item of data) {
            const message = imageErrorMessage(item);
            if (message) return message;
        }
        return null;
    }
    if (typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    for (const key of ["message", "msg", "error_message", "detail", "reason", "error", "body", "data"]) {
        const message = imageErrorMessage(record[key]);
        if (message) return message;
    }
    return null;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    if (status && status >= 500) return `${fallback}，图片服务暂时繁忙，请稍后重试`;
    return status ? `${fallback}：${status}` : fallback;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: Pick<AiConfig, "baseUrl" | "apiKey">, contentType?: string) {
    const apiKey = config.apiKey.trim();
    return {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [config.systemPrompt.trim(), ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig = typeof toolChoice === "object" ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] } : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config), signal: options?.signal },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const tokaxisGoogleImage = isTokaxisGoogleImageModel(requestConfig.model);
    const requestSize = tokaxisGoogleImage ? resolveTokaxisGoogleRequestSize(config.size) : resolveRequestSize(quality, config.size);
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (tokaxisGoogleImage) {
        try {
            return await requestTokaxisGoogleChatImages(requestConfig, prompt, [], n, requestSize, quality, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const requestModel = requestConfig.model;
    try {
        const response = await axios.post<string>(
            aiApiUrl(requestConfig, "/images/generations"),
            {
                model: requestModel,
                prompt: withSystemPrompt(requestConfig, prompt),
                n,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                response_format: "b64_json",
                output_format: IMAGE_OUTPUT_FORMAT,
            },
            {
                headers: aiHeaders(requestConfig, "application/json"),
                signal: options?.signal,
                responseType: "text",
                transformResponse: [(body) => body],
            },
        );
        const images = await validateDecodedImageResults(parseImagePayload(parseImageResponseBody(response.data)));
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(mask ? buildMaskConstrainedImageEditPrompt(prompt) : prompt, references);
    const quality = normalizeQuality(config.quality);
    const tokaxisGoogleImage = isTokaxisGoogleImageModel(requestConfig.model);
    const requestSize = tokaxisGoogleImage ? resolveTokaxisGoogleRequestSize(config.size) : resolveRequestSize(quality, config.size);
    if (requestConfig.apiFormat === "gemini") {
        if (mask) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (tokaxisGoogleImage) {
        if (mask) throw new Error("Google 生图模型暂不支持蒙版编辑");
        try {
            return await requestTokaxisGoogleChatImages(requestConfig, requestPrompt, references, n, requestSize, quality, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const formData = new FormData();
    const requestModel = requestConfig.model;
    formData.set("model", requestModel);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    formData.set("response_format", "b64_json");
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (/^gpt-image(?:-|$)/i.test(requestModel)) {
        formData.set("input_fidelity", "high");
    }
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    try {
        const response = await axios.post<string>(aiApiUrl(requestConfig, "/images/edits"), formData, {
            headers: aiHeaders(requestConfig),
            signal: options?.signal,
            responseType: "text",
            transformResponse: [(body) => body],
        });
        const images = await validateDecodedImageResults(parseImagePayload(parseImageResponseBody(response.data)));
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const answer =
            (
                await requestStreamingResponse(
                    requestConfig,
                    {
                        model: requestConfig.model,
                        input: toResponseInput(withSystemMessage(requestConfig, messages)),
                    },
                    onDelta,
                    options,
                )
            ).content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestToolResponse(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            return await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages, toGeminiToolOptions(tools, toolChoice)), onDelta, options);
        }
        return await requestStreamingResponse(
            requestConfig,
            {
                model: requestConfig.model,
                input: toResponseInput(withSystemMessage(requestConfig, messages)),
                tools: tools.map(toResponseTool),
                tool_choice: toolChoice,
                parallel_tool_calls: false,
            },
            onDelta,
            options,
        );
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), { headers: aiHeaders(config) });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
