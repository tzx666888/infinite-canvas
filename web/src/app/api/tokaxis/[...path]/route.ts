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

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
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
