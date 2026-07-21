"use client";

import { APP_VERSION } from "@/constant/env";

type TelemetryEventType =
    | "agent_turn"
    | "generation"
    | "prompt_edited"
    | "node_regenerated"
    | "node_deleted_after_generation"
    | "node_downloaded"
    | "node_connected_downstream"
    | "fusion_plan_decision";

type TelemetryPayload = Record<string, unknown> & { canvasId?: string };
type TelemetryEvent = Record<string, unknown>;
type QueuedEvent = { serialized: string; bytes: number };

const ANON_ID_KEY = "infinite-canvas-telemetry-anon-id";
const FLUSH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const MAX_BATCH_BYTES = 60 * 1024;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_EVENT_BYTES = 16 * 1024;
const SOURCE_KINDS = new Set(["user_typed", "builtin_template", "agent_generated", "prompt_library"]);
const EVENT_TYPES = new Set<TelemetryEventType>([
    "agent_turn",
    "generation",
    "prompt_edited",
    "node_regenerated",
    "node_deleted_after_generation",
    "node_downloaded",
    "node_connected_downstream",
    "fusion_plan_decision",
]);
const AGENT_ERROR_KINDS = new Set([
    "user_rejected",
    "missing_node_id",
    "missing_required",
    "skipped_after_failure",
    "invalid_args",
    "noop",
    "exec_failed",
    "unknown_keys_stripped",
]);
const GENERATION_ERROR_KINDS = new Set([
    "",
    "cancelled",
    "timeout",
    "rate_limited",
    "auth_failed",
    "content_policy",
    "network",
    "invalid_args",
    "exec_failed",
    "user_cancelled",
    "planner_failed",
    "partial_failure",
]);

const queue: QueuedEvent[] = [];
const hashCache = new Map<string, Promise<string>>();
let anonIdMemory = "";
let sessionId = "";
let randomCounter = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleReady = false;
let flushInFlightCount = 0;

export function track(eventType: TelemetryEventType, payload: TelemetryPayload = {}): void {
    try {
        if (!EVENT_TYPES.has(eventType)) return;
        prepareLifecycle();
        void buildEvent(eventType, payload)
            .then((event) => {
                try {
                    if (!event || containsForbiddenContent(event)) return;
                    const serialized = JSON.stringify(event);
                    const bytes = byteLength(serialized);
                    if (bytes > MAX_EVENT_BYTES) return;
                    queue.push({ serialized, bytes });
                    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                        flushWithBeacon();
                    } else if (queue.length - flushInFlightCount >= FLUSH_SIZE || queuedByteLength(flushInFlightCount) > MAX_BATCH_BYTES) {
                        flush();
                    } else {
                        scheduleFlush();
                    }
                } catch {
                    return;
                }
            })
            .catch(() => {});
    } catch {
        return;
    }
}

async function buildEvent(eventType: TelemetryEventType, payload: TelemetryPayload): Promise<TelemetryEvent | null> {
    try {
        if (typeof window === "undefined" || typeof payload.canvasId !== "string" || !payload.canvasId) return null;
        const common = {
            anonId: getAnonId(),
            sessionId: getSessionId(),
            ts: new Date().toISOString(),
            eventType,
            canvasId: await hashId(payload.canvasId),
            appVersion: APP_VERSION,
        };

        if (eventType === "agent_turn") {
            return compact({
                ...common,
                userMessageLength: numberValue(payload.userMessageLength),
                userMessageText: textValue(payload.userMessageText),
                assistantTextLength: numberValue(payload.assistantTextLength),
                toolCalls: toolCallValues(payload.toolCalls),
                opsCount: numberValue(payload.opsCount),
                turnIndex: numberValue(payload.turnIndex),
                durationMs: numberValue(payload.durationMs),
                model: identifierValue(payload.model),
            });
        }
        if (eventType === "generation") {
            const ok = booleanValue(payload.ok);
            return compact({
                ...common,
                mode: enumValue(payload.mode, ["image", "video", "text", "audio"]),
                model: identifierValue(payload.model),
                ok,
                durationMs: numberValue(payload.durationMs),
                errorKind: generationErrorKind(payload.errorKind, ok),
                promptLength: numberValue(payload.promptLength),
                promptText: textValue(payload.promptText),
                sourceKind: sourceKindValue(payload.sourceKind),
                templateId: identifierValue(payload.templateId),
            });
        }
        if (eventType === "prompt_edited") {
            return compact({
                ...common,
                beforeText: textValue(payload.beforeText),
                afterText: textValue(payload.afterText),
                previousSourceKind: sourceKindValue(payload.previousSourceKind),
                regenerated: booleanValue(payload.regenerated),
            });
        }
        if (eventType === "node_regenerated") {
            return compact({
                ...common,
                attemptIndex: numberValue(payload.attemptIndex),
            });
        }
        if (eventType === "fusion_plan_decision") {
            return compact({
                ...common,
                decision: enumValue(payload.decision, ["confirmed", "cancelled"]),
                productCount: numberValue(payload.productCount),
                plannerDurationMs: numberValue(payload.plannerDurationMs),
                plannerModel: identifierValue(payload.plannerModel),
            });
        }
        return common;
    } catch {
        return null;
    }
}

function getAnonId() {
    try {
        if (anonIdMemory) return anonIdMemory;
        const existing = localStorage.getItem(ANON_ID_KEY);
        if (existing && isSafeId(existing)) {
            anonIdMemory = existing;
            return anonIdMemory;
        }
        anonIdMemory = randomId();
        try {
            localStorage.setItem(ANON_ID_KEY, anonIdMemory);
        } catch {}
        return anonIdMemory;
    } catch {
        if (!anonIdMemory) anonIdMemory = randomId();
        return anonIdMemory;
    }
}

function getSessionId() {
    try {
        if (!sessionId) sessionId = randomId();
        return sessionId;
    } catch {
        if (!sessionId) sessionId = `s_${Date.now().toString(36)}_${++randomCounter}`;
        return sessionId;
    }
}

function randomId() {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch {}
    try {
        if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return `r_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        }
    } catch {}
    randomCounter += 1;
    const randomPart = Math.random().toString(36).slice(2);
    return `r_${Date.now().toString(36)}_${randomCounter.toString(36)}_${randomPart || "fallback"}`;
}

function isSafeId(value: string) {
    return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function hashId(value: string) {
    const cached = hashCache.get(value);
    if (cached) return cached;
    const pending = computeHash(value);
    hashCache.set(value, pending);
    return pending;
}

async function computeHash(value: string) {
    try {
        if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
            return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        }
    } catch {}
    return fallbackHash(value);
}

function fallbackHash(value: string) {
    const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5];
    return seeds
        .map((seed, index) => {
            let hash = seed ^ value.length ^ index;
            for (let offset = 0; offset < value.length; offset += 1) {
                hash ^= value.charCodeAt(offset) + index;
                hash = Math.imul(hash, 0x01000193);
                hash ^= hash >>> 13;
            }
            return (hash >>> 0).toString(16).padStart(8, "0");
        })
        .join("");
}

function scheduleFlush() {
    try {
        if (flushTimer) return;
        flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
    } catch {
        return;
    }
}

function flush() {
    try {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        if (flushInFlightCount || !queue.length) return;
        const batch = peekBatch();
        if (!batch) return;
        let pending: Promise<Response>;
        try {
            pending = fetch("/api/telemetry", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: batch.body,
                keepalive: true,
            });
        } catch {
            scheduleFlush();
            return;
        }
        flushInFlightCount = batch.count;
        let delivered = false;
        void pending
            .then(
                () => {
                    try {
                        queue.splice(0, batch.count);
                        delivered = true;
                    } catch {
                        return;
                    }
                },
                () => {},
            )
            .finally(() => {
                try {
                    flushInFlightCount = 0;
                    if (!queue.length) return;
                    if (delivered) flush();
                    else scheduleFlush();
                } catch {
                    return;
                }
            })
            .catch(() => {});
    } catch {
        return;
    }
}

function flushWithBeacon() {
    try {
        if (!queue.length || typeof navigator.sendBeacon !== "function") return;
        while (queue.length > flushInFlightCount) {
            const batch = peekBatch(flushInFlightCount);
            if (!batch) break;
            const accepted = navigator.sendBeacon("/api/telemetry", new Blob([batch.body], { type: "application/json" }));
            if (!accepted) break;
            queue.splice(flushInFlightCount, batch.count);
        }
        if (queue.length === flushInFlightCount && flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (queue.length > flushInFlightCount) scheduleFlush();
    } catch {
        return;
    }
}

function peekBatch(offset = 0) {
    try {
        if (queue.length <= offset) return null;
        let bytes = 2;
        let count = 0;
        const serialized: string[] = [];
        for (let index = offset; index < queue.length; index += 1) {
            const item = queue[index];
            if (count >= MAX_BATCH_SIZE) break;
            const nextBytes = bytes + item.bytes + (count ? 1 : 0);
            if (nextBytes > MAX_BATCH_BYTES) break;
            serialized.push(item.serialized);
            bytes = nextBytes;
            count += 1;
        }
        return count ? { body: `[${serialized.join(",")}]`, count } : null;
    } catch {
        return null;
    }
}

function queuedByteLength(offset = 0) {
    try {
        let bytes = 2;
        for (let index = offset; index < queue.length; index += 1) bytes += queue[index].bytes + (index > offset ? 1 : 0);
        return bytes;
    } catch {
        return MAX_BATCH_BYTES + 1;
    }
}

function prepareLifecycle() {
    try {
        if (lifecycleReady || typeof window === "undefined") return;
        lifecycleReady = true;
        window.addEventListener("pagehide", flushWithBeacon);
        document.addEventListener("visibilitychange", () => {
            try {
                if (document.visibilityState === "hidden") flushWithBeacon();
            } catch {
                return;
            }
        });
    } catch {
        return;
    }
}

function containsForbiddenContent(value: unknown): boolean {
    try {
        if (typeof value === "string") return isForbiddenString(value);
        if (Array.isArray(value)) return value.some(containsForbiddenContent);
        if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(containsForbiddenContent);
        return false;
    } catch {
        return true;
    }
}

function isForbiddenString(value: string) {
    let decoded = value;
    for (let pass = 0; pass < 3; pass += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        } catch {
            break;
        }
    }
    const compactMarkers = decoded.replace(/\s+/g, "");
    if (/base64/i.test(compactMarkers)) return true;
    if (/(?:^|[^A-Za-z0-9+.-])(?:data|blob):/i.test(compactMarkers)) return true;
    if (/\b(?:https?|ftps?|file|mailto|tel|sms|ssh|sftp|ws|wss|ipfs|ipns|chrome|about|javascript):/i.test(compactMarkers)) return true;
    if (/(?:^|[^A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\//.test(decoded)) return true;
    if (/\/\/[A-Za-z0-9_-]/.test(compactMarkers)) return true;
    if (/(?:^|[^@\p{L}\p{N}_.-])(?:www\.)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[A-Za-z0-9-]{2,59})(?=$|[\/:?#\s"'()<>\]])/iu.test(decoded)) return true;
    if (/(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s"'<>]*\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?|jfif)(?=$|[?#\s"'()<>\]])/i.test(decoded)) return true;
    return containsEncodedPayload(decoded);
}

function containsEncodedPayload(value: string) {
    try {
        const candidates = value.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) || [];
        const grouped = value.match(/(?:[A-Za-z0-9+/_-]{4}[ \t\r\n]+){2,}[A-Za-z0-9+/_-]{2,4}={0,2}/g) || [];
        const wrapped = value.match(/(?:[A-Za-z0-9+/_-]{24,}[ \t]*\r?\n[ \t]*)+[A-Za-z0-9+/_-]{8,}={0,2}/g) || [];
        for (const candidate of [...candidates, ...grouped, ...wrapped]) {
            const compact = candidate.replace(/\s+/g, "");
            if (compact.length >= 80) return true;
            const bytes = decodeBase64Bytes(compact);
            if (bytes && encodedBytesContainForbiddenPayload(bytes)) return true;
        }
        return false;
    } catch {
        return true;
    }
}

function decodeBase64Bytes(value: string) {
    try {
        if (value.length < 16 || value.length % 4 === 1 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
        const normalized = value.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "");
        const decoded = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
        return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

function encodedBytesContainForbiddenPayload(bytes: Uint8Array, depth = 0): boolean {
    if (hasImageSignature(bytes) || decodedPayloadHasForbiddenMarker(bytes)) return true;
    if (depth >= 3) return false;
    const nested = ascii(bytes, 0, bytes.length).trim().replace(/\s+/g, "");
    const nestedBytes = decodeBase64Bytes(nested);
    return nestedBytes ? encodedBytesContainForbiddenPayload(nestedBytes, depth + 1) : false;
}

function hasImageSignature(bytes: Uint8Array) {
    const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return true;
    if (starts(0xff, 0xd8, 0xff)) return true;
    if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return true;
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return true;
    if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return true;
    if (starts(0x00, 0x00, 0x01, 0x00) || starts(0x00, 0x00, 0x02, 0x00)) return true;
    if (looksLikeBitmap(bytes)) return true;
    if (ascii(bytes, 4, 4) === "ftyp" && /^(?:avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(bytes, 8, 4))) return true;
    const prefix = ascii(bytes, 0, Math.min(bytes.length, 256)).replace(/^\u00ef\u00bb\u00bf/, "").trimStart().toLowerCase();
    return prefix.startsWith("<svg") || (prefix.startsWith("<?xml") && prefix.includes("<svg"));
}

function looksLikeBitmap(bytes: Uint8Array) {
    if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return false;
    const fileSize = uint32le(bytes, 2);
    const pixelOffset = uint32le(bytes, 10);
    return fileSize >= bytes.length && pixelOffset >= 14 && pixelOffset < fileSize;
}

function decodedPayloadHasForbiddenMarker(bytes: Uint8Array) {
    const text = ascii(bytes, 0, Math.min(bytes.length, 512)).replace(/\s+/g, "").toLowerCase();
    return text.includes("data:image") || text.includes(";base64,") || text.includes("blob:") || text.includes("http://") || text.includes("https://");
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
    return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function uint32le(bytes: Uint8Array, offset: number) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function textValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
}

function identifierValue(value: unknown) {
    return textValue(value)?.slice(0, 256);
}

function sourceKindValue(value: unknown) {
    return typeof value === "string" && SOURCE_KINDS.has(value) ? value : undefined;
}

function enumValue(value: unknown, allowed: string[]) {
    return typeof value === "string" && allowed.includes(value) ? value : undefined;
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function booleanValue(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
}

function generationErrorKind(value: unknown, ok: boolean | undefined) {
    if (ok === true) return "";
    return typeof value === "string" && GENERATION_ERROR_KINDS.has(value) && value ? value : "exec_failed";
}

function agentErrorKind(value: unknown, ok: boolean) {
    if (ok) return value === "unknown_keys_stripped" ? value : "";
    if (value === "unknown_keys_stripped") return "exec_failed";
    return typeof value === "string" && AGENT_ERROR_KINDS.has(value) ? value : "exec_failed";
}

function toolCallValues(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const call = item as Record<string, unknown>;
        const name = identifierValue(call.name);
        const ok = booleanValue(call.ok);
        if (!name || ok === undefined) return [];
        return [compact({ name, ok, errorKind: agentErrorKind(call.errorKind, ok) })];
    });
}

function byteLength(value: string) {
    try {
        return new TextEncoder().encode(value).byteLength;
    } catch {
        return unescape(encodeURIComponent(value)).length;
    }
}

function compact(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
