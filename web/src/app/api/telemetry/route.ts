import { appendFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH_SIZE = 50;
const MAX_EVENT_BYTES = 16 * 1024;
const EVENT_TYPES = new Set([
    "agent_turn",
    "generation",
    "prompt_edited",
    "node_regenerated",
    "node_deleted_after_generation",
    "node_downloaded",
    "node_connected_downstream",
    "fusion_plan_decision",
]);
const SOURCE_KINDS = new Set(["user_typed", "builtin_template", "agent_generated", "prompt_library"]);
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

let appendChain: Promise<void> = Promise.resolve();

export async function POST(request: Request) {
    try {
        if (!telemetryEnabled()) return ok();
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return ok();
        const text = await readLimitedBody(request);
        if (text === null) return ok();
        const input = JSON.parse(text);
        if (!Array.isArray(input)) return ok();
        const lines = input.slice(0, MAX_BATCH_SIZE).flatMap((event) => {
            if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_EVENT_BYTES) return [];
            const safe = rebuildEvent(event);
            if (!safe || containsForbiddenContent(safe)) return [];
            const serialized = JSON.stringify(safe);
            return Buffer.byteLength(serialized, "utf8") <= MAX_EVENT_BYTES ? [serialized] : [];
        });
        if (!lines.length) return ok();
        const directory = process.env.TELEMETRY_DIR || join(tmpdir(), "infinite-canvas-telemetry");
        const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        await enqueueAppend(directory, join(directory, `events-${day}.jsonl`), `${lines.join("\n")}\n`);
    } catch {
        return ok();
    }
    return ok();
}

function rebuildEvent(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const eventType = stringValue(input.eventType);
    if (!eventType || !EVENT_TYPES.has(eventType)) return null;

    const anonId = safeIdValue(input.anonId);
    const sessionId = safeIdValue(input.sessionId);
    const ts = timestampValue(input.ts);
    const canvasId = canvasHashValue(input.canvasId);
    const appVersion = identifierValue(input.appVersion);
    if (!anonId || !sessionId || ts === undefined || !canvasId || !appVersion) return null;

    const common = { anonId, sessionId, ts, eventType, canvasId, appVersion };
    if (eventType === "agent_turn") {
        return compact({
            ...common,
            userMessageLength: numberValue(input.userMessageLength),
            userMessageText: textValue(input.userMessageText),
            assistantTextLength: numberValue(input.assistantTextLength),
            toolCalls: toolCallValues(input.toolCalls),
            opsCount: numberValue(input.opsCount),
            turnIndex: numberValue(input.turnIndex),
            durationMs: numberValue(input.durationMs),
            model: identifierValue(input.model),
        });
    }
    if (eventType === "generation") {
        const success = booleanValue(input.ok);
        return compact({
            ...common,
            mode: enumValue(input.mode, ["image", "video", "text", "audio"]),
            model: identifierValue(input.model),
            ok: success,
            durationMs: numberValue(input.durationMs),
            errorKind: generationErrorKind(input.errorKind, success),
            promptLength: numberValue(input.promptLength),
            promptText: textValue(input.promptText),
            sourceKind: sourceKindValue(input.sourceKind),
            templateId: identifierValue(input.templateId),
        });
    }
    if (eventType === "prompt_edited") {
        return compact({
            ...common,
            beforeText: textValue(input.beforeText),
            afterText: textValue(input.afterText),
            previousSourceKind: sourceKindValue(input.previousSourceKind),
            regenerated: booleanValue(input.regenerated),
        });
    }
    if (eventType === "node_regenerated") {
        return compact({
            ...common,
            attemptIndex: numberValue(input.attemptIndex),
        });
    }
    if (eventType === "fusion_plan_decision") {
        return compact({
            ...common,
            decision: enumValue(input.decision, ["confirmed", "cancelled"]),
            productCount: numberValue(input.productCount),
            plannerDurationMs: numberValue(input.plannerDurationMs),
            plannerModel: identifierValue(input.plannerModel),
        });
    }
    return common;
}

function enqueueAppend(directory: string, file: string, content: string) {
    appendChain = appendChain
        .then(async () => {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await appendFile(file, content, { encoding: "utf8", flag: "a", mode: 0o600 });
            await chmod(file, 0o600);
        })
        .catch(() => {});
    return appendChain;
}

async function readLimitedBody(request: Request) {
    if (!request.body) return "";
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => {});
            return null;
        }
        text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
}

function telemetryEnabled() {
    const value = process.env.TELEMETRY_ENABLED?.trim().toLowerCase();
    return value !== "0" && value !== "false";
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

function stringValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
}

function identifierValue(value: unknown) {
    return textValue(value)?.slice(0, 256);
}

function safeIdValue(value: unknown) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : undefined;
}

function canvasHashValue(value: unknown) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function timestampValue(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000) return value;
    return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : undefined;
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

function generationErrorKind(value: unknown, success: boolean | undefined) {
    if (success === true) return "";
    return typeof value === "string" && GENERATION_ERROR_KINDS.has(value) && value ? value : "exec_failed";
}

function agentErrorKind(value: unknown, success: boolean) {
    if (success) return value === "unknown_keys_stripped" ? value : "";
    if (value === "unknown_keys_stripped") return "exec_failed";
    return typeof value === "string" && AGENT_ERROR_KINDS.has(value) ? value : "exec_failed";
}

function toolCallValues(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const call = item as Record<string, unknown>;
        const name = identifierValue(call.name);
        const success = booleanValue(call.ok);
        if (!name || success === undefined) return [];
        return [compact({ name, ok: success, errorKind: agentErrorKind(call.errorKind, success) })];
    });
}

function compact(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function ok() {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}
