import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const IMAGE_JOB_OPERATIONS = ["generations", "edits", "chat-completions"] as const;

export type ImageJobOperation = (typeof IMAGE_JOB_OPERATIONS)[number];
export type ImageJobStatus = "running" | "succeeded" | "failed";

type ImageJobResult = {
    index: number;
    fileName: string;
    mimeType: string;
    bytes: number;
};

export type StoredImageJob = {
    id: string;
    operation: ImageJobOperation;
    status: ImageJobStatus;
    createdAt: number;
    updatedAt: number;
    workerId: string;
    error?: string;
    results?: ImageJobResult[];
};

export type PublicImageJob = {
    id: string;
    status: ImageJobStatus;
    createdAt: number;
    updatedAt: number;
    error?: string;
    results?: Array<{
        index: number;
        url: string;
        mimeType: string;
        bytes: number;
    }>;
};

type SubmitImageJobInput = {
    id: string;
    operation: ImageJobOperation;
    authorization: string;
    contentType: string;
    body: ArrayBuffer;
};

type ImageOutputSource = {
    value: string;
    mimeType?: string;
};

type ImageJobRuntime = {
    workerId: string;
    submissions: Map<string, Promise<StoredImageJob>>;
    active: Map<
        string,
        {
            controller: AbortController;
            task: Promise<void>;
        }
    >;
    lastCleanupAt: number;
};

const IMAGE_JOB_DIRECTORY = process.env.IMAGE_JOB_DIR || path.join("/tmp", "infinite-canvas-image-jobs");
const IMAGE_JOB_TTL_MS = 48 * 60 * 60 * 1000;
const IMAGE_JOB_UPSTREAM_TIMEOUT_MS = 20 * 60 * 1000;
const IMAGE_JOB_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const IMAGE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const globalRuntimeKey = Symbol.for("infinite-canvas.image-job-runtime");
const globalScope = globalThis as typeof globalThis & { [globalRuntimeKey]?: ImageJobRuntime };

const runtime: ImageJobRuntime =
    globalScope[globalRuntimeKey] ||
    (globalScope[globalRuntimeKey] = {
        workerId: randomUUID(),
        submissions: new Map(),
        active: new Map(),
        lastCleanupAt: 0,
    });
runtime.submissions ||= new Map();

export function isValidImageJobId(value: string) {
    return IMAGE_JOB_ID_PATTERN.test(value);
}

export function isImageJobOperation(value: string): value is ImageJobOperation {
    return IMAGE_JOB_OPERATIONS.includes(value as ImageJobOperation);
}

export function submitImageJob(input: SubmitImageJobInput) {
    const pending = runtime.submissions.get(input.id);
    if (pending) return pending;

    const submission = submitImageJobOnce(input).finally(() => {
        runtime.submissions.delete(input.id);
    });
    runtime.submissions.set(input.id, submission);
    return submission;
}

async function submitImageJobOnce(input: SubmitImageJobInput) {
    await ensureImageJobDirectory();
    void cleanupExpiredImageJobs().catch(() => undefined);

    const existing = await readStoredImageJob(input.id);
    if (existing) return existing;

    const now = Date.now();
    const job: StoredImageJob = {
        id: input.id,
        operation: input.operation,
        status: "running",
        createdAt: now,
        updatedAt: now,
        workerId: runtime.workerId,
    };
    await writeStoredImageJob(job);

    const controller = new AbortController();
    const task = executeImageJob(job, input, controller)
        .catch(async (error) => {
            await failImageJob(job, imageJobErrorMessage(error));
        })
        .finally(() => {
            runtime.active.delete(job.id);
        });
    runtime.active.set(job.id, { controller, task });
    return job;
}

export async function getImageJob(jobId: string) {
    await ensureImageJobDirectory();
    void cleanupExpiredImageJobs().catch(() => undefined);
    const job = await readStoredImageJob(jobId);
    if (!job) return null;

    if (job.status === "running" && job.workerId !== runtime.workerId) {
        return failImageJob(job, "图片任务因服务重启而中断，请重新生成");
    }
    return job;
}

export function toPublicImageJob(job: StoredImageJob): PublicImageJob {
    return {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        error: job.error,
        results: job.results?.map((result) => ({
            index: result.index,
            url: `/api/image-jobs/${encodeURIComponent(job.id)}/result/${result.index}`,
            mimeType: result.mimeType,
            bytes: result.bytes,
        })),
    };
}

export async function cancelImageJob(jobId: string) {
    const active = runtime.active.get(jobId);
    if (active) {
        active.controller.abort(new DOMException("图片任务已取消", "AbortError"));
        await active.task;
    }

    const job = await readStoredImageJob(jobId);
    if (!job || job.status !== "running") return job;
    return failImageJob(job, "图片任务已取消");
}

export async function readImageJobResult(jobId: string, index: number) {
    const job = await getImageJob(jobId);
    if (!job || job.status !== "succeeded") return null;
    const result = job.results?.find((item) => item.index === index);
    if (!result) return null;
    try {
        return {
            bytes: await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ IMAGE_JOB_DIRECTORY, result.fileName)),
            mimeType: result.mimeType,
        };
    } catch {
        return null;
    }
}

export function collectImageJobOutputs(payload: unknown): ImageOutputSource[] {
    const outputs: ImageOutputSource[] = [];
    const seen = new Set<string>();

    const visit = (value: unknown, key = "", depth = 0) => {
        if (depth > 8 || value == null) return;
        if (typeof value === "string") {
            const output = imageOutputFromString(value, key);
            if (output && !seen.has(output.value)) {
                seen.add(output.value);
                outputs.push(output);
            }
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, key, depth + 1));
            return;
        }
        if (typeof value !== "object") return;
        Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => visit(childValue, childKey, depth + 1));
    };

    visit(payload);
    return outputs;
}

async function executeImageJob(job: StoredImageJob, input: SubmitImageJobInput, controller: AbortController) {
    const timeout = setTimeout(() => controller.abort(new DOMException("图片生成超时", "TimeoutError")), IMAGE_JOB_UPSTREAM_TIMEOUT_MS);
    try {
        const response = await fetch(imageJobUpstreamUrl(input.operation), {
            method: "POST",
            headers: {
                Authorization: input.authorization,
                "Content-Type": input.contentType,
                "Accept-Encoding": "identity",
            },
            body: new Uint8Array(input.body),
            cache: "no-store",
            signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) throw new Error(upstreamFailureMessage(responseText, response.status));

        let payload: unknown;
        try {
            payload = JSON.parse(responseText);
        } catch {
            throw new Error("图片服务返回格式异常，请重试");
        }
        const upstreamError = objectErrorMessage(payload);
        if (upstreamError) throw new Error(upstreamError);

        const outputs = collectImageJobOutputs(payload);
        if (!outputs.length) throw new Error("图片服务没有返回有效图片");

        const results: ImageJobResult[] = [];
        for (let index = 0; index < outputs.length; index += 1) {
            results.push(await persistImageOutput(job.id, index, outputs[index], controller.signal));
        }
        await writeStoredImageJob({
            ...job,
            status: "succeeded",
            updatedAt: Date.now(),
            results,
            error: undefined,
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function failImageJob(job: StoredImageJob, error: string) {
    const failed: StoredImageJob = {
        ...job,
        status: "failed",
        updatedAt: Date.now(),
        error,
        results: undefined,
    };
    await writeStoredImageJob(failed);
    return failed;
}

function imageJobUpstreamUrl(operation: ImageJobOperation) {
    const origin = (process.env.TOKAXIS_INTERNAL_ORIGIN || "https://ai.tokaxis.com").replace(/\/+$/, "");
    const pathName = operation === "chat-completions" ? "chat/completions" : `images/${operation}`;
    return `${origin}/v1/${pathName}`;
}

function imageOutputFromString(value: string, key: string): ImageOutputSource | null {
    const text = value.trim();
    if (!text) return null;
    if (/^data:image\//i.test(text)) {
        const mimeType = /^data:([^;,]+)/i.exec(text)?.[1];
        return { value: text, mimeType };
    }
    if (/^https?:\/\//i.test(text) && ["url", "image_url", "file_uri", "fileuri"].includes(key.toLowerCase())) {
        return { value: text };
    }
    const normalizedKey = key.toLowerCase();
    if (["b64_json", "base64", "image_base64"].includes(normalizedKey) && isPlausibleBase64(text)) {
        return { value: text.replace(/\s/g, ""), mimeType: "image/png" };
    }
    if (normalizedKey === "data" && text.length > 80 && isPlausibleBase64(text)) {
        return { value: text.replace(/\s/g, ""), mimeType: "image/png" };
    }
    return null;
}

function isPlausibleBase64(value: string) {
    const compact = value.replace(/\s/g, "");
    return compact.length >= 16 && compact.length % 4 !== 1 && BASE64_PATTERN.test(compact);
}

async function persistImageOutput(jobId: string, index: number, output: ImageOutputSource, signal: AbortSignal): Promise<ImageJobResult> {
    let bytes: Uint8Array;
    let declaredMimeType = output.mimeType;

    if (/^https?:\/\//i.test(output.value)) {
        const response = await fetch(output.value, { cache: "no-store", signal });
        if (!response.ok) throw new Error(`图片结果下载失败（${response.status}）`);
        bytes = new Uint8Array(await response.arrayBuffer());
        declaredMimeType = response.headers.get("content-type") || declaredMimeType;
    } else {
        const dataUrl = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(output.value);
        const encoded = dataUrl ? dataUrl[3] : output.value;
        declaredMimeType = dataUrl?.[1] || declaredMimeType;
        bytes = new Uint8Array(Buffer.from(dataUrl?.[2] ? encoded : decodeURIComponent(encoded), dataUrl?.[2] || !dataUrl ? "base64" : "utf8"));
    }

    if (!bytes.byteLength) throw new Error("图片结果为空");
    const mimeType = detectImageMimeType(bytes, declaredMimeType);
    const extension = imageExtension(mimeType);
    const fileName = `${jobId}-${index}.${extension}`;
    await writeFileAtomically(path.join(/* turbopackIgnore: true */ IMAGE_JOB_DIRECTORY, fileName), bytes);
    return { index, fileName, mimeType, bytes: bytes.byteLength };
}

function detectImageMimeType(bytes: Uint8Array, declared?: string) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
    if (ascii(bytes, 4, 12).includes("ftyp")) return "image/avif";
    return declared?.startsWith("image/") ? declared.split(";")[0] : "image/png";
}

function ascii(bytes: Uint8Array, start: number, end: number) {
    return String.fromCharCode(...bytes.slice(start, end));
}

function imageExtension(mimeType: string) {
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("avif")) return "avif";
    return "png";
}

function upstreamFailureMessage(text: string, status: number) {
    const parsed = parseJson(text);
    return objectErrorMessage(parsed) || `图片服务请求失败（${status}）`;
}

function objectErrorMessage(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of ["error", "message", "msg", "detail", "reason"]) {
        const item = record[key];
        if (typeof item === "string" && item.trim()) return item.trim().slice(0, 500);
        const nested = objectErrorMessage(item);
        if (nested) return nested;
    }
    return null;
}

function parseJson(value: string) {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

function imageJobErrorMessage(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") return error.message.includes("取消") ? "图片任务已取消" : "图片生成超时，请重新生成";
    if (error instanceof DOMException && error.name === "TimeoutError") return "图片生成超时，请重新生成";
    if (error instanceof Error) return error.message.trim().slice(0, 500) || "图片生成失败";
    return "图片生成失败";
}

async function ensureImageJobDirectory() {
    await mkdir(/* turbopackIgnore: true */ IMAGE_JOB_DIRECTORY, { recursive: true });
}

function imageJobMetadataPath(jobId: string) {
    return path.join(/* turbopackIgnore: true */ IMAGE_JOB_DIRECTORY, `${jobId}.json`);
}

async function readStoredImageJob(jobId: string): Promise<StoredImageJob | null> {
    try {
        return JSON.parse(await readFile(/* turbopackIgnore: true */ imageJobMetadataPath(jobId), "utf8")) as StoredImageJob;
    } catch {
        return null;
    }
}

async function writeStoredImageJob(job: StoredImageJob) {
    await writeFileAtomically(imageJobMetadataPath(job.id), JSON.stringify(job));
}

async function writeFileAtomically(targetPath: string, value: string | Uint8Array) {
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    await writeFile(/* turbopackIgnore: true */ temporaryPath, value);
    await rename(/* turbopackIgnore: true */ temporaryPath, /* turbopackIgnore: true */ targetPath);
}

async function cleanupExpiredImageJobs() {
    const now = Date.now();
    if (now - runtime.lastCleanupAt < IMAGE_JOB_CLEANUP_INTERVAL_MS) return;
    runtime.lastCleanupAt = now;
    await ensureImageJobDirectory();
    const entries = await readdir(/* turbopackIgnore: true */ IMAGE_JOB_DIRECTORY, { withFileTypes: true });
    const expiredIds: string[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const jobId = entry.name.slice(0, -5);
        const job = await readStoredImageJob(jobId);
        if (job && now - job.updatedAt > IMAGE_JOB_TTL_MS && !runtime.active.has(jobId)) expiredIds.push(jobId);
    }

    await Promise.all(
        expiredIds.flatMap((jobId) =>
            entries
                .filter((entry) => entry.isFile() && (entry.name === `${jobId}.json` || entry.name.startsWith(`${jobId}-`)))
                .map((entry) => unlink(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ IMAGE_JOB_DIRECTORY, entry.name)).catch(() => undefined)),
        ),
    );
}
