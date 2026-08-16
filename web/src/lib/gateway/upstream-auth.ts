import { getCanvasUpstreamApiKey, saveCanvasUpstreamApiKey } from "../auth/store.ts";

type CanvasUpstreamIdentity = {
    userId: string;
    username: string;
    displayName: string;
};

type CachedUpstreamKey = { authorization: string; expiresAt: number };

const upstreamKeyCache = new Map<string, CachedUpstreamKey>();
const UPSTREAM_KEY_CACHE_MS = 10 * 60_000;

export async function resolveCanvasUpstreamAuthorization(identity: CanvasUpstreamIdentity) {
    const fallback = normalizeAuthorization(process.env.CANVAS_UPSTREAM_API_KEY || "");
    const cached = upstreamKeyCache.get(identity.userId);
    if (cached && cached.expiresAt > Date.now()) return cached.authorization;

    const stored = getCanvasUpstreamApiKey(identity.userId);
    if (stored) {
        const authorization = normalizeAuthorization(stored);
        upstreamKeyCache.set(identity.userId, { authorization, expiresAt: Date.now() + UPSTREAM_KEY_CACHE_MS });
        return authorization;
    }

    const origin = (process.env.CANVAS_UPSTREAM_ORIGIN || process.env.TOKAXIS_INTERNAL_ORIGIN || "").replace(/\/+$/, "");
    const secret = process.env.CANVAS_AUTH_SHARED_SECRET?.trim();
    if (!origin || !secret || secret.length < 32) return fallback;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        const response = await fetch(`${origin}/api/internal/canvas/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Canvas-Auth-Secret": secret },
            body: JSON.stringify({ username: identity.username, display_name: identity.displayName }),
            cache: "no-store",
            signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: { api_key?: unknown } } | null;
        const apiKey = typeof payload?.data?.api_key === "string" ? payload.data.api_key.trim() : "";
        if (!response.ok || !payload?.success || !apiKey) return fallback;
        saveCanvasUpstreamApiKey(identity.userId, apiKey);
        const authorization = normalizeAuthorization(apiKey);
        upstreamKeyCache.set(identity.userId, { authorization, expiresAt: Date.now() + UPSTREAM_KEY_CACHE_MS });
        return authorization;
    } catch {
        return fallback;
    }
}

function normalizeAuthorization(value: string | null) {
    const token = (value || "").trim();
    if (!token) return "";
    return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}
