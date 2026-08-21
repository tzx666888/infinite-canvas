import { AuthError } from "@/lib/auth/auth-error";
import { isIP } from "node:net";

type AttemptWindow = { count: number; resetAt: number };

const windows = new Map<string, AttemptWindow>();
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_WINDOWS = 5_000;
let lastCleanupAt = 0;

export function requestAddress(request: Request) {
    const candidates = [request.headers.get("cf-connecting-ip"), request.headers.get("x-real-ip"), request.headers.get("x-forwarded-for")?.split(",")[0]];
    for (const candidate of candidates) {
        const value = candidate?.trim() || "";
        if (value && isIP(value)) return value;
    }
    return "unknown";
}

export function enforceRateLimit(key: string, limit = 8, windowMs = 10 * 60 * 1000) {
    const now = Date.now();
    if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS || windows.size >= MAX_TRACKED_WINDOWS) {
        for (const [candidate, window] of windows) {
            if (window.resetAt <= now) windows.delete(candidate);
        }
        lastCleanupAt = now;
    }

    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
        if (!current && windows.size >= MAX_TRACKED_WINDOWS) throw new AuthError("登录请求过多，请稍后再试", 429);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return;
    }
    if (current.count >= limit) throw new AuthError("尝试次数过多，请 10 分钟后再试", 429);
    current.count += 1;
}

export function clearRateLimit(key: string) {
    windows.delete(key);
}
