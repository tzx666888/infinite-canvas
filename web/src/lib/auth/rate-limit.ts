import { AuthError } from "./auth-error.ts";
import { isIP } from "node:net";

type AttemptWindow = { count: number; resetAt: number };

const windows = new Map<string, AttemptWindow>();
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_WINDOWS = 5_000;
let lastCleanupAt = 0;

export function requestAddress(request: Request) {
    // The public reverse proxy overwrites X-Real-IP after validating the
    // Cloudflare source range. Never trust client-supplied Cloudflare or
    // X-Forwarded-For headers inside the application.
    const candidates = [request.headers.get("x-real-ip")];
    for (const candidate of candidates) {
        const value = candidate?.trim() || "";
        if (value && isIP(value)) return value;
    }
    return "unknown";
}

export function enforceRateLimit(key: string, limit = 8, windowMs = 10 * 60 * 1000, message = "请求过多，请稍后再试") {
    const now = Date.now();
    if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS || windows.size >= MAX_TRACKED_WINDOWS) {
        for (const [candidate, window] of windows) {
            if (window.resetAt <= now) windows.delete(candidate);
        }
        lastCleanupAt = now;
    }

    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
        if (!current && windows.size >= MAX_TRACKED_WINDOWS) throw new AuthError(message, 429, "rate_limit_exceeded");
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return;
    }
    if (current.count >= limit) throw new AuthError(message, 429, "rate_limit_exceeded");
    current.count += 1;
}

export function clearRateLimit(key: string) {
    windows.delete(key);
}
