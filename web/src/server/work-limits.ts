import { AuthError } from "../lib/auth/auth-error.ts";

const scope = globalThis as typeof globalThis & { __canvasWorkLimits?: Map<string, Map<string, number>> };
const pools = scope.__canvasWorkLimits ||= new Map();

/** Admission happens synchronously, before buffering uploads or launching work. */
export function acquireWorkSlot(pool: "image" | "upload" | "conversion", userId: string) {
    const defaults = { image: [32, 8], upload: [16, 4], conversion: [2, 1] }[pool];
    const limit = (suffix: string, fallback: number) => {
        const n = Number(process.env[`CANVAS_${pool.toUpperCase()}_${suffix}`]);
        return Number.isSafeInteger(n) && n > 0 ? n : fallback;
    };
    const users = pools.get(pool) || new Map<string, number>();
    pools.set(pool, users);
    const count = users.get(userId) || 0;
    const total = [...users.values()].reduce((a, b) => a + b, 0);
    if (count >= limit("USER_CONCURRENCY", defaults[1]) || total >= limit("CONCURRENCY", defaults[0])) {
        throw new AuthError("当前处理任务较多，请等待已有任务完成后重试", 429, "work_capacity_exceeded");
    }
    users.set(userId, count + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const remaining = (users.get(userId) || 1) - 1;
        if (remaining) users.set(userId, remaining);
        else users.delete(userId);
    };
}

export async function readBoundedBody(request: Request, maxBytes: number) {
    const declared = request.headers.get("content-length");
    if (declared && (!Number.isSafeInteger(Number(declared)) || Number(declared) < 0 || Number(declared) > maxBytes)) {
        throw new AuthError("上传内容过大或长度无效", 413, "request_body_too_large");
    }
    if (!request.body) return new ArrayBuffer(0);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new AuthError("上传超时，请重试", 408, "upload_timeout"));
            void reader.cancel().catch(() => undefined);
        }, 120_000);
    });
    try {
        for (;;) {
            const { done, value } = await Promise.race([reader.read(), deadline]);
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) throw new AuthError("上传内容过大", 413, "request_body_too_large");
            chunks.push(value);
        }
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        return body.buffer;
    } finally {
        clearTimeout(timer!);
        void reader.cancel().catch(() => undefined);
    }
}

export async function boundedFormData(request: Request, maxBytes: number) {
    const body = await readBoundedBody(request, maxBytes);
    return new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") || "" }, body }).formData();
}
