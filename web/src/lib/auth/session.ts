import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { AuthError } from "@/lib/auth/auth-error";

export const AUTH_COOKIE_NAME = "infinite_canvas_session";

type SessionPayload = {
    sub: string;
    iat: number;
    exp: number;
    nonce: string;
};

function sessionSecret() {
    const value = process.env.CANVAS_SESSION_SECRET?.trim();
    if (!value || value.length < 32) throw new AuthError("账户服务尚未完成安全配置", 503);
    return value;
}

function signature(payload: string) {
    return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function sessionTtlSeconds() {
    const configured = Number(process.env.CANVAS_SESSION_TTL_DAYS || 7);
    return Math.max(1, Math.min(30, Number.isFinite(configured) ? Math.floor(configured) : 7)) * 24 * 60 * 60;
}

export function createSessionToken(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = { sub: userId, iat: now, exp: now + sessionTtlSeconds(), nonce: randomUUID() };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${signature(encoded)}`;
}

export function readSessionToken(value: string | undefined): SessionPayload | null {
    if (!value) return null;
    const [encoded, receivedSignature, ...extra] = value.split(".");
    if (!encoded || !receivedSignature || extra.length) return null;
    const expectedSignature = signature(encoded);
    const received = Buffer.from(receivedSignature);
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
        if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch {
        return null;
    }
}

export function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: sessionTtlSeconds(),
    };
}
