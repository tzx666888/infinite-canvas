import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKAXIS_ORIGIN = (process.env.TOKAXIS_INTERNAL_ORIGIN || "https://ai.tokaxis.com").replace(/\/+$/, "");
const LONG_RUNNING_IMAGE_PATH = /^v1\/images\/(?:generations|edits)$/;
const IMAGE_HEARTBEAT_INTERVAL_MS = 15_000;
const IMAGE_HEARTBEAT_CHUNK = new TextEncoder().encode(`${" ".repeat(4096)}\n`);
const FORWARDED_PATHS = [
    /^v1\/responses$/,
    /^v1\/chat\/completions$/,
    /^v1\/images\/(?:generations|edits)$/,
    /^v1\/audio\/speech$/,
    /^v1\/videos\/generations$/,
    /^v1\/videos(?:\/[^/]+(?:\/content)?)?$/,
    /^v1\/contents\/generations\/tasks(?:\/[^/]+)?$/,
    /^v1\/models$/,
];
const STRIPPED_REQUEST_HEADERS = [
    "authorization",
    "x-tokaxis-api-key",
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
const STRIPPED_RESPONSE_HEADERS = ["connection", "content-encoding", "transfer-encoding"];
const legacyGrokVideoTaskIds = new Set<string>();

type RouteContext = {
    params: Promise<{ path?: string[] }> | { path?: string[] };
};

export async function GET(request: NextRequest, context: RouteContext) {
    return proxyTokaxis(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
    return proxyTokaxis(request, context);
}

export function OPTIONS() {
    return new Response(null, { status: 204, headers: { Allow: "GET,POST,OPTIONS" } });
}

async function proxyTokaxis(request: NextRequest, context: RouteContext) {
    const params = await Promise.resolve(context.params);
    const path = (params.path || []).join("/");
    if (!FORWARDED_PATHS.some((pattern) => pattern.test(path))) {
        return Response.json({ error: { message: "TokAxis proxy path is not allowed" } }, { status: 404 });
    }

    const authorization = normalizeAuthorization(request.headers.get("authorization"));
    if (!authorization) {
        return Response.json({ error: { message: "TokAxis API Key is required" } }, { status: 401 });
    }

    const upstreamUrl = new URL(`${TOKAXIS_ORIGIN}/${path}`);
    upstreamUrl.search = request.nextUrl.search;

    const headers = new Headers(request.headers);
    STRIPPED_REQUEST_HEADERS.forEach((name) => headers.delete(name));
    headers.set("Authorization", authorization);

    if (request.method === "POST" && path === "v1/videos/generations") {
        return proxyLegacyGrokVideoGeneration(request, authorization);
    }
    const legacyVideoTaskId = request.method === "GET" ? /^v1\/videos\/([^/]+)$/.exec(path)?.[1] : undefined;
    if (legacyVideoTaskId && legacyGrokVideoTaskIds.has(legacyVideoTaskId)) {
        return proxyLegacyGrokVideoPoll(upstreamUrl, authorization, legacyVideoTaskId);
    }

    const body = request.method === "GET" ? undefined : await request.arrayBuffer();
    if (request.method === "POST" && LONG_RUNNING_IMAGE_PATH.test(path)) {
        return proxyLongRunningImage(upstreamUrl, headers, body);
    }

    const upstreamResponse = await fetch(upstreamUrl, { method: request.method, headers, body, cache: "no-store" });

    const responseHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
        if (!STRIPPED_RESPONSE_HEADERS.includes(key.toLowerCase())) responseHeaders.set(key, value);
    });
    responseHeaders.set("Cache-Control", "no-store");

    if (!upstreamResponse.ok && /^v1\/videos(?:\/|$)/.test(path)) {
        const responseText = await upstreamResponse.text();
        console.error("[tokaxis-proxy] video upstream failed", {
            path,
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            body: responseText.slice(0, 1000),
        });
        return new Response(responseText, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders,
        });
    }

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}

async function proxyLegacyGrokVideoGeneration(request: NextRequest, authorization: string) {
    try {
        const payload = (await request.json()) as LegacyGrokVideoPayload;
        const form = new FormData();
        form.append("model", stringValue(payload.model) || "grok-imagine-video");
        form.append("prompt", stringValue(payload.prompt));
        const references = Array.isArray(payload.reference_images) ? payload.reference_images.slice(0, 7) : [];
        form.append("seconds", legacyGrokVideoSeconds(payload.duration ?? payload.seconds, references.length));
        form.append("size", legacyVideoSize(payload.aspect_ratio));
        form.append("resolution_name", legacyVideoResolution(payload.resolution));
        form.append("preset", "normal");

        for (const [index, reference] of references.entries()) {
            const blob = await legacyReferenceImageBlob(reference?.url);
            if (blob) form.append("input_reference", blob, `reference-${index + 1}.${legacyImageExtension(blob.type)}`);
        }

        const upstreamUrl = new URL(`${TOKAXIS_ORIGIN}/v1/videos`);
        const upstreamResponse = await fetch(upstreamUrl, { method: "POST", headers: { Authorization: authorization }, body: form, cache: "no-store" });
        const responseText = await upstreamResponse.text();
        if (!upstreamResponse.ok) {
            console.error("[tokaxis-proxy] legacy video upstream failed", {
                status: upstreamResponse.status,
                statusText: upstreamResponse.statusText,
                referenceCount: references.length,
                body: responseText.slice(0, 1000),
            });
        }
        const taskId = readVideoTaskId(responseText);
        if (taskId) legacyGrokVideoTaskIds.add(taskId);
        return new Response(responseText, { status: upstreamResponse.status, statusText: upstreamResponse.statusText, headers: jsonResponseHeaders(upstreamResponse.headers) });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Grok 视频任务创建失败";
        return Response.json({ error: { message } }, { status: 400 });
    }
}

async function proxyLegacyGrokVideoPoll(upstreamUrl: URL, authorization: string, taskId: string) {
    const upstreamResponse = await fetch(upstreamUrl, { method: "GET", headers: { Authorization: authorization }, cache: "no-store" });
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
    reference_images?: Array<{ url?: unknown } | null>;
    aspect_ratio?: unknown;
    resolution?: unknown;
};

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
    if ((status === "completed" || status === "succeeded" || status === "done") && videoUrl) {
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
    const video = task.video;
    if (video && typeof video === "object") {
        const url = stringValue((video as Record<string, unknown>).url);
        if (url) return url;
    }
    const content = task.content;
    if (content && typeof content === "object") {
        const url = stringValue((content as Record<string, unknown>).video_url);
        if (url) return url;
    }
    return stringValue(task.video_url);
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
    return ratio === "9:16" ? "720x1280" : ratio === "16:9" ? "1280x720" : "720x1280";
}

function legacyVideoResolution(value: unknown) {
    const resolution = stringValue(value).replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function legacyGrokVideoSeconds(value: unknown, referenceCount = 0) {
    const raw = typeof value === "number" ? value : Number(stringValue(value));
    const seconds = Math.floor(Number.isFinite(raw) && raw > 0 ? raw : 15);
    const options = [6, 10, 15];
    const nearest = options.reduce((best, candidate) => (Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best));
    return String(referenceCount > 0 ? Math.min(nearest, 10) : nearest);
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

function proxyLongRunningImage(upstreamUrl: URL, headers: Headers, body: ArrayBuffer | undefined) {
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

            void relayImageResponse(upstreamUrl, headers, body, abortController.signal, controller, stopHeartbeat)
                .catch(() => {
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

async function relayImageResponse(
    upstreamUrl: URL,
    headers: Headers,
    body: ArrayBuffer | undefined,
    signal: AbortSignal,
    controller: ReadableStreamDefaultController<Uint8Array>,
    onResponse: () => void,
) {
    const upstreamResponse = await requestLongRunningImage(upstreamUrl, headers, body, signal);
    onResponse();
    const contentType = String(upstreamResponse.headers["content-type"] || "");
    if (!contentType.toLowerCase().includes("json")) {
        upstreamResponse.resume();
        controller.enqueue(encodeImageProxyError(`图片服务返回异常（${upstreamResponse.statusCode || 502}），请稍后重试`));
        return;
    }

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
