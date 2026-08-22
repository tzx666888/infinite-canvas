import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { AuthError, authErrorResponse } from "../../../../lib/auth/auth-error.ts";
import { enforceRateLimit, requestAddress } from "../../../../lib/auth/rate-limit.ts";
import { authenticateCanvasApiKey } from "../../../../lib/auth/store.ts";
import { ensureGatewayTaskReconciler, finalizeGatewayResponse, publicModelPrices, reconcileGatewayTaskResponse, refundGatewayReservation, reserveGatewayRequest, settleGatewayReservation, type GatewayReservation } from "../../../../lib/gateway/billing.ts";
import { buildCanvasAttributionHeaders } from "../../../../lib/gateway/attribution.ts";
import { sanitizeGatewayErrorResponse } from "../../../../lib/gateway/errors.ts";
import { resolveCanvasUpstreamAuthorization } from "../../../../lib/gateway/upstream-auth.ts";
import { storeTemporaryMediaDataUrl } from "../../../../lib/temporary-media.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_ORIGIN = (process.env.CANVAS_UPSTREAM_ORIGIN || process.env.TOKAXIS_INTERNAL_ORIGIN || "").replace(/\/+$/, "");
const LONG_RUNNING_IMAGE_PATH = /^v1\/images\/(?:generations|edits)$/;
const IMAGE_HEARTBEAT_INTERVAL_MS = 15_000;
const IMAGE_HEARTBEAT_CHUNK = new TextEncoder().encode(`${" ".repeat(4096)}\n`);
const MAX_GATEWAY_BODY_BYTES = positiveEnvironmentInteger("CANVAS_GATEWAY_MAX_BODY_BYTES", 64 * 1024 * 1024);
const GATEWAY_IP_RATE_LIMIT = positiveEnvironmentInteger("CANVAS_GATEWAY_IP_RATE_LIMIT", 120);
const GATEWAY_KEY_RATE_LIMIT = positiveEnvironmentInteger("CANVAS_GATEWAY_KEY_RATE_LIMIT", 120);
const GATEWAY_RATE_WINDOW_MS = 60_000;
const FORWARDED_PATHS = [
    /^v1\/responses$/,
    /^v1\/chat\/completions$/,
    /^v1\/images\/(?:generations|edits)$/,
    /^v1\/audio\/speech$/,
    /^v1\/videos\/generations(?:\/[^/]+)?$/,
    /^v1\/videos(?:\/[^/]+(?:\/content)?)?$/,
    /^v1\/contents\/generations\/tasks(?:\/[^/]+)?$/,
    /^v1\/models$/,
];
const STRIPPED_REQUEST_HEADERS = [
    "accept-encoding",
    "authorization",
    "x-tokaxis-api-key",
    "x-canvas-user-id",
    "x-canvas-username",
    "x-canvas-attribution",
    "x-canvas-request-id",
    "cookie",
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];
const STRIPPED_RESPONSE_HEADERS = ["connection", "content-encoding", "content-length", "transfer-encoding", "x-oneapi-request-id", "x-oneapi-node", "x-oneapi-version"];
const GROK_VIDEO_CHANNEL_UNAVAILABLE_MESSAGE = "Grok 视频通道当前没有可用额度或正在冷却，请更换可用 Grok 视频通道后再试";
const TOKAXIS_ASYNC_VIDEO_MODELS = new Set(["seedance 2.0-fast-720p", "qy-seedance-2.0", "qy-seedance-2.0-fast", "minimaxh3-720p", "minimaxh3-2k"]);
const TOKAXIS_LEGACY_GROK_VIDEO_MODELS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const legacyGrokVideoTaskIds = new Set<string>();

type RouteContext = {
    params: Promise<{ path?: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
    return proxyGateway(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
    return proxyGateway(request, context);
}

export function OPTIONS() {
    return new Response(null, { status: 204, headers: { Allow: "GET,POST,OPTIONS" } });
}

async function proxyGateway(request: NextRequest, context: RouteContext) {
    let reservation: GatewayReservation | null = null;
    try {
        const params = await context.params;
        const path = (params.path || []).join("/");
        if (!FORWARDED_PATHS.some((pattern) => pattern.test(path))) return Response.json({ error: { message: "模型接口路径不受支持" } }, { status: 404 });

        rejectOversizedContentLength(request);
        enforceRateLimit(`gateway-ip:${requestAddress(request)}`, GATEWAY_IP_RATE_LIMIT, GATEWAY_RATE_WINDOW_MS, "模型网关请求过多，请稍后再试");

        const suppliedAuthorization = request.headers.get("authorization") || "";
        const identity = await authenticateCanvasApiKey(suppliedAuthorization);
        if (!identity) return Response.json({ error: { code: "invalid_api_key", message: "画布专用 Key 无效" } }, { status: 401 });
        enforceRateLimit(`gateway-key:${identity.keyId}`, GATEWAY_KEY_RATE_LIMIT, GATEWAY_RATE_WINDOW_MS, "此画布 Key 请求过多，请稍后再试");
        if (!UPSTREAM_ORIGIN) throw new AuthError("模型服务尚未配置", 503, "gateway_not_configured");
        const authorization = resolveCanvasUpstreamAuthorization();
        if (!authorization) throw new AuthError("模型服务授权尚未配置", 503, "gateway_not_configured");

        const rawBody = request.method === "GET" ? undefined : await readBoundedRequestBody(request);
        const bodyRequest = () => recreateRequest(request, rawBody);
        ensureGatewayTaskReconciler();
        reservation = await reserveGatewayRequest(bodyRequest(), path, { keyId: identity.keyId, userId: identity.user.id });

        const upstreamUrl = new URL(`${UPSTREAM_ORIGIN}/${path}`);
        upstreamUrl.search = request.nextUrl.search;

        const headers = new Headers(request.headers);
        STRIPPED_REQUEST_HEADERS.forEach((name) => headers.delete(name));
        headers.set("Authorization", authorization);
        headers.set("Accept-Encoding", "identity");
        const canvasRequestId = request.headers.get("x-canvas-request-id")?.trim() || randomUUID();
        buildCanvasAttributionHeaders({ userId: identity.user.id, username: identity.user.username }, canvasRequestId).forEach((value, key) => headers.set(key, value));

        let videoModel = "";
        if (request.method === "POST" && path === "v1/videos/generations") {
            videoModel = await videoGenerationRequestModel(bodyRequest());
            if (!isTokaxisAsyncVideoModel(videoModel)) {
                if (isTokaxisLegacyGrokVideoModel(videoModel)) return finishGatewayResponse(await proxyLegacyGrokVideoGeneration(bodyRequest(), authorization, headers), reservation);
                return finishGatewayResponse(Response.json({ error: { code: "unsupported_video_model", message: `视频模型 ${videoModel || "(空)"} 不支持此生成接口` } }, { status: 400 }), reservation);
            }
        }
        const legacyVideoTaskId = request.method === "GET" ? /^v1\/videos\/([^/]+)$/.exec(path)?.[1] : undefined;
        if (legacyVideoTaskId && legacyGrokVideoTaskIds.has(legacyVideoTaskId)) return reconcileGatewayTaskResponse(path, await proxyLegacyGrokVideoPoll(upstreamUrl, authorization, legacyVideoTaskId, headers));

        let body: ArrayBuffer | undefined;
        try {
            body = rawBody === undefined ? undefined : isMiniMaxH3Model(videoModel) ? await prepareMiniMaxH3RequestBody(bodyRequest()) : exactArrayBuffer(rawBody);
        } catch (error) {
            const message = error instanceof Error ? error.message : "参考素材处理失败";
            return finishGatewayResponse(Response.json({ error: { code: "invalid_reference_media", message } }, { status: 400 }), reservation);
        }
        if (request.method === "POST" && LONG_RUNNING_IMAGE_PATH.test(path)) return proxyLongRunningImage(upstreamUrl, headers, body, reservation);

        const upstreamResponse = await fetch(upstreamUrl, { method: request.method, headers, body, cache: "no-store" });

        const responseHeaders = new Headers();
        upstreamResponse.headers.forEach((value, key) => {
            if (!STRIPPED_RESPONSE_HEADERS.includes(key.toLowerCase())) responseHeaders.set(key, value);
        });
        responseHeaders.set("Cache-Control", "no-store");

        if (!upstreamResponse.ok) {
            const responseText = await upstreamResponse.text();
            console.error("[canvas-gateway] upstream request failed", { path, status: upstreamResponse.status, body: responseText.slice(0, 1000) });
            return finishGatewayResponse(
                new Response(sanitizeGatewayErrorResponse(responseText, upstreamResponse.status), { status: upstreamResponse.status, headers: { ...Object.fromEntries(responseHeaders.entries()), "Content-Type": "application/json; charset=utf-8" } }),
                reservation,
            );
        }

        if (request.method === "GET" && path === "v1/models") {
            const catalogResponse = await filterPublicModelCatalog(upstreamResponse, responseHeaders);
            return finalizeGatewayResponse(catalogResponse, reservation);
        }

        const response = new Response(upstreamResponse.body, { status: upstreamResponse.status, statusText: upstreamResponse.statusText, headers: responseHeaders });
        const finalized = await finalizeGatewayResponse(response, reservation);
        return request.method === "GET" ? reconcileGatewayTaskResponse(path, finalized) : finalized;
    } catch (error) {
        if (reservation) refundGatewayReservation(reservation, "模型服务连接失败，积分退回");
        return authErrorResponse(error);
    }
}

function positiveEnvironmentInteger(name: string, fallback: number) {
    const value = Number(process.env[name] || fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function rejectOversizedContentLength(request: Request) {
    const raw = request.headers.get("content-length");
    if (!raw) return;
    const length = Number(raw);
    if (!Number.isSafeInteger(length) || length < 0) throw new AuthError("Content-Length 无效", 400, "invalid_content_length");
    if (length > MAX_GATEWAY_BODY_BYTES) throw new AuthError("请求内容过大", 413, "request_body_too_large");
}

async function readBoundedRequestBody(request: Request) {
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_GATEWAY_BODY_BYTES) throw new AuthError("请求内容过大", 413, "request_body_too_large");
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

function recreateRequest(request: NextRequest, body: Uint8Array | undefined) {
    return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: body === undefined ? undefined : exactArrayBuffer(body),
    });
}

function exactArrayBuffer(value: Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
}

async function filterPublicModelCatalog(upstreamResponse: Response, responseHeaders: Headers) {
    const payload = await upstreamResponse.json().catch(() => null);
    const allowedModels = new Set(Object.keys(publicModelPrices()).map((model) => model.toLowerCase()));
    const data =
        payload && typeof payload === "object" && "data" in payload && Array.isArray((payload as { data?: unknown }).data)
            ? (payload as { data: unknown[] }).data.filter((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && allowedModels.has((item as { id: string }).id.toLowerCase()))
            : [];
    const filteredPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...(payload as Record<string, unknown>), data } : { object: "list", data };
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(filteredPayload), { status: upstreamResponse.status, statusText: upstreamResponse.statusText, headers: responseHeaders });
}

async function finishGatewayResponse(response: Response, reservation: GatewayReservation | null) {
    if (!response.ok) {
        if (reservation) refundGatewayReservation(reservation, "请求未被模型服务接受，积分退回");
        const text = await response.text();
        return new Response(sanitizeGatewayErrorResponse(text, response.status), { status: response.status, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } });
    }
    return finalizeGatewayResponse(response, reservation);
}

async function prepareMiniMaxH3RequestBody(request: Request) {
    const payload = (await request.json()) as Record<string, unknown>;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("MiniMax H3 视频请求必须是 JSON 对象");
    const publicOrigin = process.env.CANVAS_PUBLIC_ORIGIN || new URL(request.url).origin;
    for (const field of ["images", "reference_images", "reference_image_urls", "audios", "reference_audios"] as const) {
        const value = payload[field];
        if (value !== undefined) payload[field] = Array.isArray(value) ? await Promise.all(value.map((item) => materializeMiniMaxH3Media(item, publicOrigin))) : await materializeMiniMaxH3Media(value, publicOrigin);
    }
    for (const field of ["image", "first_image", "last_image", "start_frame", "end_frame", "input_reference"] as const) {
        if (payload[field] !== undefined) payload[field] = await materializeMiniMaxH3Media(payload[field], publicOrigin);
    }
    return new Blob([JSON.stringify(payload)], { type: "application/json" }).arrayBuffer();
}

async function materializeMiniMaxH3Media(value: unknown, publicOrigin: string): Promise<unknown> {
    if (typeof value === "string") return value.startsWith("data:") ? storeTemporaryMediaDataUrl(value, publicOrigin) : value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = { ...(value as Record<string, unknown>) };
    if (typeof record.url === "string" && record.url.startsWith("data:")) record.url = await storeTemporaryMediaDataUrl(record.url, publicOrigin);
    if (record.image_url && typeof record.image_url === "object" && !Array.isArray(record.image_url)) {
        record.image_url = await materializeMiniMaxH3Media(record.image_url, publicOrigin);
    }
    return record;
}

async function videoGenerationRequestModel(request: Request) {
    try {
        const payload = (await request.clone().json()) as { model?: unknown };
        return typeof payload?.model === "string" ? payload.model : "";
    } catch {
        return "";
    }
}

function isTokaxisAsyncVideoModel(model: string) {
    return TOKAXIS_ASYNC_VIDEO_MODELS.has(model.trim().toLowerCase().split("::").at(-1) || "");
}

function isMiniMaxH3Model(model: string) {
    return new Set(["minimaxh3-720p", "minimaxh3-2k"]).has(model.trim().toLowerCase().split("::").at(-1) || "");
}

function isTokaxisLegacyGrokVideoModel(model: string) {
    return TOKAXIS_LEGACY_GROK_VIDEO_MODELS.has(model.trim().toLowerCase().split("::").at(-1) || "");
}

async function proxyLegacyGrokVideoGeneration(request: Request, authorization: string, upstreamHeaders: Headers) {
    try {
        const payload = (await request.json()) as LegacyGrokVideoPayload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("视频请求必须是 JSON 对象");
        const inputImage = payload.image === undefined ? null : legacyVideoImage(payload.image, "image");
        const rawReferences = payload.reference_images ?? payload.images;
        if (rawReferences !== undefined && !Array.isArray(rawReferences)) throw new Error("reference_images 必须是图片数组");
        if (Array.isArray(rawReferences) && rawReferences.length > 7) throw new Error("参考图最多支持 7 张");
        const referenceImages = (rawReferences || []).map((reference, index) => legacyVideoImage(reference, `reference_images[${index}]`));
        if (inputImage && referenceImages.length) throw new Error("image 与 reference_images 不能同时使用");
        const videoMode: LegacyGrokVideoMode = inputImage ? "i2v" : referenceImages.length ? "r2v" : "t2v";
        const model = stringValue(payload.model) || "grok-imagine-video-1.5-fast";
        const seconds = legacyGrokVideoSeconds(payload.duration ?? payload.seconds, videoMode, model);
        const resolution = legacyVideoResolution(payload.resolution, model);
        const storageOptions = legacyVideoStorageOptions(payload.storage_options);
        const body = {
            model,
            prompt: stringValue(payload.prompt),
            seconds,
            duration: Number(seconds),
            size: legacyVideoSize(payload.aspect_ratio),
            aspect_ratio: stringValue(payload.aspect_ratio) || "9:16",
            resolution,
            resolution_name: resolution,
            preset: "normal",
            // ai.tokaxis.com's legacy /v1/videos DTO declares `image` as a
            // string.  Channel 32 then normalizes that string back to xAI's
            // `{ url }` shape.  Forwarding the object here is rejected by the
            // gateway before the channel adapter ever sees the request.
            ...(videoMode === "i2v" ? { image: legacyVideoImageUrl(inputImage) } : videoMode === "r2v" ? { reference_images: referenceImages } : {}),
            ...(storageOptions ? { storage_options: storageOptions } : {}),
        };

        try {
            const { upstreamResponse, responseText, attempt } = await postLegacyGrokVideoJson(body, authorization, upstreamHeaders);
            if (!upstreamResponse.ok) {
                console.error("[tokaxis-proxy] legacy video upstream failed", {
                    status: upstreamResponse.status,
                    statusText: upstreamResponse.statusText,
                    attempts: attempt,
                    referenceCount: referenceImages.length,
                    videoMode,
                    body: responseText.slice(0, 1000),
                });
            }
            const normalizedFailureText = normalizeLegacyVideoCreateFailureText(responseText);
            const submissionUnknown = !normalizedFailureText && (upstreamResponse.status === 408 || upstreamResponse.status === 409 || upstreamResponse.status === 425 || upstreamResponse.status >= 500);
            if (submissionUnknown) return videoSubmissionUnknownResponse(upstreamResponse.status);
            const normalizedResponseText = normalizedFailureText || responseText;
            const taskId = readVideoTaskId(normalizedResponseText);
            if (taskId) legacyGrokVideoTaskIds.add(taskId);
            return new Response(normalizedResponseText, { status: upstreamResponse.status, statusText: upstreamResponse.statusText, headers: jsonResponseHeaders(upstreamResponse.headers) });
        } catch (error) {
            console.error("[tokaxis-proxy] video submission result unknown", {
                message: error instanceof Error ? error.message : "upstream connection failed",
                referenceCount: referenceImages.length,
                videoMode,
            });
            return videoSubmissionUnknownResponse();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Grok 视频任务创建失败";
        return Response.json({ error: { message } }, { status: 400 });
    }
}

function videoSubmissionUnknownResponse(upstreamStatus?: number) {
    const message = "视频提交结果未知，系统没有自动重建任务；请先检查任务列表，避免重复生成和重复扣费";
    return Response.json({ error: { code: "video_submission_result_unknown", message, ...(upstreamStatus ? { upstream_status: upstreamStatus } : {}) } }, { status: 424 });
}

async function postLegacyGrokVideoJson(body: Record<string, unknown>, authorization: string, upstreamHeaders: Headers) {
    const upstreamUrl = new URL(`${UPSTREAM_ORIGIN}/v1/videos`);
    const requestBody = JSON.stringify(body);
    // Creating a video is billable and the upstream contract has no shared
    // idempotency key. A timeout/disconnect/5xx can occur after the task was
    // accepted, so this proxy must never create a second task automatically.
    const headers = new Headers(upstreamHeaders);
    headers.set("Authorization", authorization);
    headers.set("Content-Type", "application/json");
    const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: requestBody,
        cache: "no-store",
    });
    const responseText = await upstreamResponse.text();
    return { upstreamResponse, responseText, attempt: 1 };
}

function normalizeLegacyVideoCreateFailureText(responseText: string) {
    const text = responseText.toLowerCase();
    if (!isNonRetryableGrokVideoCapacityFailure(text)) return "";
    return JSON.stringify({
        code: "grok_video_channel_unavailable",
        message: GROK_VIDEO_CHANNEL_UNAVAILABLE_MESSAGE,
        error: { code: "grok_video_channel_unavailable", message: GROK_VIDEO_CHANNEL_UNAVAILABLE_MESSAGE },
    });
}

function isNonRetryableGrokVideoCapacityFailure(text: string) {
    return (
        (text.includes("resource-exhausted") && text.includes("grok-imagine-video")) ||
        (text.includes("requests per minute") && text.includes("0/0")) ||
        (text.includes("all credentials for model") && text.includes("cooling down")) ||
        text.includes("model_cooldown") ||
        text.includes("authentication token has been invalidated") ||
        text.includes("prompt length exceeds") ||
        text.includes("当前分组上游负载已饱和")
    );
}

async function proxyLegacyGrokVideoPoll(upstreamUrl: URL, authorization: string, taskId: string, upstreamHeaders: Headers) {
    const headers = new Headers(upstreamHeaders);
    headers.set("Authorization", authorization);
    const upstreamResponse = await fetch(upstreamUrl, { method: "GET", headers, cache: "no-store" });
    const responseText = await upstreamResponse.text();
    const payload = parseJson(responseText);
    if (!payload) return new Response(responseText, { status: upstreamResponse.status, statusText: upstreamResponse.statusText, headers: jsonResponseHeaders(upstreamResponse.headers) });

    const normalized = normalizeLegacyGrokPollPayload(payload);
    const task = envelopeData(normalized);
    if (task && typeof task === "object") {
        const status = stringValue((task as Record<string, unknown>).status).toLowerCase();
        if (status === "done" || status === "failed" || status === "expired" || status === "cancelled") legacyGrokVideoTaskIds.delete(taskId);
    }
    return Response.json(normalized, { status: upstreamResponse.status, statusText: upstreamResponse.statusText, headers: jsonResponseHeaders(upstreamResponse.headers) });
}

type LegacyGrokVideoPayload = {
    model?: unknown;
    prompt?: unknown;
    seconds?: unknown;
    duration?: unknown;
    image?: unknown;
    reference_images?: unknown;
    images?: unknown;
    aspect_ratio?: unknown;
    resolution?: unknown;
    storage_options?: unknown;
};

type LegacyGrokVideoMode = "t2v" | "i2v" | "r2v";
type LegacyGrokVideoImage = { url: string } | { file_id: string };

function legacyVideoImage(value: unknown, field: string): LegacyGrokVideoImage {
    if (typeof value === "string" && value.trim()) return { url: value.trim() };
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} 缺少有效图片`);
    const record = value as Record<string, unknown>;
    const fileId = stringValue(record.file_id);
    if (fileId) return { file_id: fileId };
    const nestedImageUrl = record.image_url && typeof record.image_url === "object" ? stringValue((record.image_url as Record<string, unknown>).url) : "";
    const url = stringValue(record.url) || nestedImageUrl;
    if (!url) throw new Error(`${field} 缺少 url 或 file_id`);
    return { url };
}

function legacyVideoImageUrl(value: LegacyGrokVideoImage | null) {
    if (!value || !("url" in value) || !value.url) throw new Error("image 需要可访问的 url 或 data URI");
    return value.url;
}

function legacyVideoStorageOptions(value: unknown) {
    if (value === undefined) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("storage_options 必须是 JSON 对象");
    return value as Record<string, unknown>;
}

function normalizeLegacyGrokPollPayload(payload: unknown): unknown {
    const task = envelopeData(payload);
    if (!task || typeof task !== "object") return payload;
    const normalizedTask = normalizeLegacyGrokTask(task as Record<string, unknown>);
    if (payload && typeof payload === "object" && "data" in payload) return { ...(payload as Record<string, unknown>), data: normalizedTask };
    return normalizedTask;
}

function normalizeLegacyGrokTask(task: Record<string, unknown>) {
    const status = stringValue(task.status).toLowerCase();
    const videoUrl = legacyVideoUrl(task);
    if ((status === "completed" || status === "succeeded" || status === "done" || status === "success" || status === "finished") && videoUrl) {
        return { ...task, status: "done", video: { ...(typeof task.video === "object" && task.video ? task.video : {}), url: videoUrl } };
    }
    if (status === "cancelled") return { ...task, status: "failed", error: task.error || { message: "视频生成已取消" } };
    return task;
}

function envelopeData(payload: unknown) {
    if (payload && typeof payload === "object" && "data" in payload) return (payload as { data?: unknown }).data;
    return payload;
}

function readVideoTaskId(responseText: string) {
    const payload = parseJson(responseText);
    const task = envelopeData(payload);
    if (!task || typeof task !== "object") return "";
    return stringValue((task as Record<string, unknown>).id) || stringValue((task as Record<string, unknown>).request_id);
}

function legacyVideoUrl(task: Record<string, unknown>) {
    const directUrl = firstUsableVideoUrl(task.video_url, task.result_url, task.url, task.output);
    if (directUrl) return directUrl;

    const content = task.content;
    if (content && typeof content === "object") {
        const url = firstUsableVideoUrl((content as Record<string, unknown>).video_url, (content as Record<string, unknown>).url);
        if (url) return url;
    }
    const video = task.video;
    if (video && typeof video === "object") {
        const url = firstUsableVideoUrl((video as Record<string, unknown>).url);
        if (url) return url;
    }
    return "";
}

function firstUsableVideoUrl(...values: unknown[]) {
    let fallback = "";
    for (const value of values) {
        const url = firstHttpUrl(value);
        if (!url) continue;
        if (!isProtectedVideoContentUrl(url)) return url;
        fallback ||= url;
    }
    return fallback;
}

function firstHttpUrl(value: unknown): string {
    if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? value.trim() : "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const url = firstHttpUrl(item);
            if (url) return url;
        }
    }
    return "";
}

function isProtectedVideoContentUrl(value: string) {
    try {
        return /\/v1\/videos\/[^/]+\/content(?:$|[?#])/.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

async function legacyReferenceImageBlob(value: unknown) {
    const url = stringValue(value);
    if (!url) return null;
    if (url.startsWith("data:image/")) return dataUrlToBlob(url);
    if (!/^https?:\/\//i.test(url)) return null;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return response.blob();
}

function dataUrlToBlob(dataUrl: string) {
    const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
    if (!match) throw new Error("参考图格式不正确，请重新生成宫格图");
    const mimeType = match[1] || "image/png";
    const body = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
    return new Blob([body], { type: mimeType });
}

function legacyVideoSize(value: unknown) {
    const ratio = stringValue(value);
    return ratio === "16:9" ? "1280x720" : ratio === "1:1" ? "720x720" : "720x1280";
}

function legacyVideoResolution(value: unknown, model = "") {
    const resolution = stringValue(value).replace(/p$/i, "") || "720";
    if (resolution === "1080" && stringValue(model).trim().toLowerCase() !== "grok-imagine-video-1.5-1080p") return "720p";
    return `${resolution}p`;
}

function legacyGrokVideoSeconds(value: unknown, mode: LegacyGrokVideoMode = "t2v", model = "") {
    const raw = typeof value === "number" ? value : Number(stringValue(value));
    const seconds = Math.floor(Number.isFinite(raw) && raw > 0 ? raw : 15);
    const options = [6, 10, 15];
    const nearest = options.reduce((best, candidate) => (Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best));
    const normalizedModel = stringValue(model).trim().toLowerCase();
    const isFastModel = normalizedModel === "grok-imagine-video-1.5-fast";
    const isTenSecondModel = normalizedModel === "grok-imagine-video-1.5-preview" || normalizedModel === "grok-imagine-video-1.5-1080p";
    return String(isTenSecondModel || mode === "r2v" || (!isFastModel && mode !== "t2v") ? Math.min(nearest, 10) : nearest);
}

function legacyImageExtension(mimeType: string) {
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    return "png";
}

function parseJson(value: string) {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function jsonResponseHeaders(upstreamHeaders: Headers) {
    const responseHeaders = new Headers();
    upstreamHeaders.forEach((value, key) => {
        if (!STRIPPED_RESPONSE_HEADERS.includes(key.toLowerCase())) responseHeaders.set(key, value);
    });
    responseHeaders.set("Cache-Control", "no-store");
    if (!responseHeaders.has("Content-Type")) responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return responseHeaders;
}

function proxyLongRunningImage(upstreamUrl: URL, headers: Headers, body: ArrayBuffer | undefined, reservation: GatewayReservation | null) {
    const abortController = new AbortController();
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let canceled = false;

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const enqueueHeartbeat = () => {
                if (!canceled) controller.enqueue(IMAGE_HEARTBEAT_CHUNK);
            };

            enqueueHeartbeat();
            heartbeatTimer = setInterval(enqueueHeartbeat, IMAGE_HEARTBEAT_INTERVAL_MS);

            const stopHeartbeat = () => {
                if (heartbeatTimer) clearInterval(heartbeatTimer);
                heartbeatTimer = undefined;
            };

            void relayImageResponse(upstreamUrl, headers, body, abortController.signal, controller, stopHeartbeat, reservation)
                .catch(() => {
                    if (reservation) refundGatewayReservation(reservation, "图片服务连接失败，积分退回");
                    if (!canceled) controller.enqueue(encodeImageProxyError("图片服务连接中断，请稍后重试"));
                })
                .finally(() => {
                    stopHeartbeat();
                    if (!canceled) controller.close();
                });
        },
        cancel() {
            canceled = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            abortController.abort();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "X-Accel-Buffering": "no",
        },
    });
}

async function relayImageResponse(upstreamUrl: URL, headers: Headers, body: ArrayBuffer | undefined, signal: AbortSignal, controller: ReadableStreamDefaultController<Uint8Array>, onResponse: () => void, reservation: GatewayReservation | null) {
    const upstreamResponse = await requestLongRunningImage(upstreamUrl, headers, body, signal);
    onResponse();
    const contentType = String(upstreamResponse.headers["content-type"] || "");
    if (!contentType.toLowerCase().includes("json")) {
        upstreamResponse.resume();
        if (reservation) refundGatewayReservation(reservation, "图片服务返回异常，积分退回");
        controller.enqueue(encodeImageProxyError(`图片服务返回异常（${upstreamResponse.statusCode || 502}），请稍后重试`));
        return;
    }
    if ((upstreamResponse.statusCode || 500) >= 400) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of upstreamResponse) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
        const text = new TextDecoder().decode(Buffer.concat(chunks));
        if (reservation) refundGatewayReservation(reservation, "图片生成失败，积分退回");
        controller.enqueue(new TextEncoder().encode(sanitizeGatewayErrorResponse(text, upstreamResponse.statusCode || 500)));
        return;
    }
    if (reservation) settleGatewayReservation(reservation);

    for await (const chunk of upstreamResponse) {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
    }
}

function requestLongRunningImage(upstreamUrl: URL, headers: Headers, body: ArrayBuffer | undefined, signal: AbortSignal) {
    return new Promise<IncomingMessage>((resolve, reject) => {
        const requestHeaders = Object.fromEntries(headers.entries());
        if (body) requestHeaders["content-length"] = String(body.byteLength);
        const request = (upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest)(upstreamUrl, { method: "POST", headers: requestHeaders, signal }, resolve);
        request.on("error", reject);
        request.end(body ? Buffer.from(body) : undefined);
    });
}

function encodeImageProxyError(message: string) {
    return new TextEncoder().encode(JSON.stringify({ error: { message } }));
}

function normalizeAuthorization(value: string | null) {
    const token = (value || "").trim();
    if (!token) return "";
    return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}
