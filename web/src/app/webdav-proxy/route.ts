import { NextRequest } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, requireAuthUser } from "@/lib/auth/route-utils";
import { assertSafeHttpUrl, fetchWithSafeRedirects } from "@/lib/security/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBDAV_PROXY_TIMEOUT_MS = 120000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PROPFIND", "MKCOL", "PUT", "DELETE", "COPY", "MOVE"]);

export async function POST(request: NextRequest) {
    try {
        enforceSameOrigin(request);
        await requireAuthUser();
        const target = request.headers.get("x-webdav-target") || "";
        const method = (request.headers.get("x-webdav-method") || "GET").toUpperCase();
        if (!target) return new Response("Missing x-webdav-target", { status: 400 });
        if (!ALLOWED_METHODS.has(method)) return new Response("Unsupported WebDAV method", { status: 405 });

        let url: URL;
        try {
            url = new URL(target);
        } catch {
            return new Response("Invalid x-webdav-target", { status: 400 });
        }
        await assertSafeHttpUrl(url);

        const headers = new Headers();
        copyHeader(request, headers, "x-webdav-authorization", "Authorization");
        copyHeader(request, headers, "x-webdav-depth", "Depth");
        copyHeader(request, headers, "x-webdav-destination", "Destination");
        copyHeader(request, headers, "x-webdav-overwrite", "Overwrite");
        copyHeader(request, headers, "x-webdav-content-type", "Content-Type");

        const contentLength = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return new Response("WebDAV request body too large", { status: 413 });
        const body = method === "GET" || method === "HEAD" ? undefined : await readLimitedBody(request);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WEBDAV_PROXY_TIMEOUT_MS);
        try {
            console.log(`[webdav-proxy] ${method} ${url.origin}${url.pathname} ${body?.byteLength || 0}B`);
            const response = await fetchWithSafeRedirects(url, { method, headers, body: body?.byteLength ? body : undefined, signal: controller.signal });
            console.log(`[webdav-proxy] ${method} ${url.origin}${url.pathname} -> ${response.status}`);
            return new Response(method === "HEAD" ? null : response.body, { status: response.status, headers: responseHeaders(response.headers) });
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        if (error instanceof Error && error.name === "AuthError") return authErrorResponse(error);
        if (error instanceof Error && error.name === "AbortError") return new Response("WebDAV proxy timeout", { status: 504 });
        if (error instanceof Error && error.message === "WebDAV request body too large") return new Response(error.message, { status: 413 });
        if (error instanceof Error && /目标地址|协议|重定向/.test(error.message)) return new Response(error.message, { status: 400 });
        return new Response("WebDAV proxy error", { status: 502 });
    }
}

async function readLimitedBody(request: Request) {
    if (!request.body) return undefined;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BODY_BYTES) {
                await reader.cancel().catch(() => {});
                throw new Error("WebDAV request body too large");
            }
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
    return body.buffer;
}

function copyHeader(request: NextRequest, headers: Headers, from: string, to: string) {
    const value = request.headers.get(from);
    if (value) headers.set(to, value);
}

function responseHeaders(headers: Headers) {
    const result = new Headers();
    ["content-type", "etag", "last-modified", "dav"].forEach((key) => {
        const value = headers.get(key);
        if (value) result.set(key, value);
    });
    return result;
}
