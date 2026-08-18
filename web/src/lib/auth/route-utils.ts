import { cookies } from "next/headers";

import { AuthError } from "@/lib/auth/auth-error";
import { AUTH_COOKIE_NAME, readSessionToken } from "@/lib/auth/session";
import { getAuthUser } from "@/lib/auth/store";
import type { AuthUser } from "@/lib/auth/types";

const MAX_BODY_BYTES = 16 * 1024;

export async function parseAuthBody(request: Request) {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new AuthError("提交内容过大", 413);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new AuthError("提交内容过大", 413);
    try {
        const body = JSON.parse(text) as unknown;
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
        return body as Record<string, unknown>;
    } catch {
        throw new AuthError("提交内容格式不正确");
    }
}

export function stringInput(value: unknown) {
    return typeof value === "string" ? value : "";
}

export function numberInput(value: unknown) {
    return typeof value === "number" ? value : Number(value);
}

function normalizedOrigin(value: string) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

export function enforceSameOrigin(request: Request) {
    const rawOrigin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (!rawOrigin) {
        if (fetchSite === "cross-site") throw new AuthError("请求来源不受信任", 403);
        return;
    }

    const origin = normalizedOrigin(rawOrigin);
    const requestOrigin = normalizedOrigin(request.url);
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host") || request.headers.get("x-forwarded-host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : requestUrl.protocol.replace(":", "");
    const headerOrigin = requestHost ? normalizedOrigin(`${requestProtocol}://${requestHost}`) : null;
    const configuredOrigin = process.env.CANVAS_PUBLIC_ORIGIN ? normalizedOrigin(process.env.CANVAS_PUBLIC_ORIGIN) : null;
    if (!origin || (origin !== requestOrigin && origin !== headerOrigin && origin !== configuredOrigin)) throw new AuthError("请求来源不受信任", 403);
}

export async function currentAuthUser(): Promise<AuthUser | null> {
    const cookieStore = await cookies();
    const session = readSessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
    return session ? getAuthUser(session.sub) : null;
}

export async function requireRootUser() {
    const user = await requireAuthUser();
    if (user.role !== "root" || user.username.trim().toLowerCase() !== "root") throw new AuthError("没有此操作权限", 403);
    return user;
}

export async function requireAdminUser() {
    const user = await requireAuthUser();
    if (user.role !== "root" && user.role !== "admin") throw new AuthError("没有此操作权限", 403);
    return user;
}

export async function requireAuthUser() {
    const user = await currentAuthUser();
    if (!user) throw new AuthError("请先登录", 401);
    return user;
}
