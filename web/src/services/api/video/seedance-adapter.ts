import axios from "axios";

import type { VideoGenerationTask, VideoGenerationTaskState, VideoRequestOptions } from "@/services/api/video/provider-contract";

type SeedanceTaskResponse = {
    id?: string;
    task_id?: string;
    status?: string;
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    video?: { url?: string; video_url?: string } | null;
    metadata?: { url?: string; video_url?: string } | null;
    url?: string;
};

type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string };

export async function createSeedanceVideoTaskRequest(input: { endpoint: string; headers: Record<string, string>; model: string; payload: Record<string, unknown>; options?: VideoRequestOptions }): Promise<VideoGenerationTask> {
    const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTaskResponse>>(input.endpoint, input.payload, { headers: input.headers, signal: input.options?.signal })).data);
    const taskId = created.id || created.task_id;
    if (!taskId) throw new Error("Seedance 接口没有返回任务 ID");
    return { id: taskId, provider: "seedance", model: input.model };
}

export async function pollSeedanceVideoTaskRequest(input: { endpoint: string; contentEndpoint?: string; headers: Record<string, string>; options?: VideoRequestOptions }): Promise<VideoGenerationTaskState> {
    const parsed = parseSeedanceVideoTaskState((await axios.get<ApiEnvelope<SeedanceTaskResponse>>(input.endpoint, { headers: input.headers, signal: input.options?.signal })).data);
    if (parsed.status !== "completed" || !parsed.result.url || !isProtectedVideoContentUrl(parsed.result.url) || !input.contentEndpoint) return parsed;
    const content = await axios.get<Blob>(input.contentEndpoint, { headers: input.headers, responseType: "blob", signal: input.options?.signal });
    await assertVideoBlob(content.data);
    return { status: "completed", result: { blob: content.data } };
}

export function parseSeedanceVideoTaskState(payload: ApiEnvelope<SeedanceTaskResponse>): VideoGenerationTaskState {
    const state = unwrapSeedanceTask(payload);
    const status = String(state.status || "")
        .trim()
        .toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success") {
        const url = state.video?.url || state.video?.video_url || state.content?.video_url || state.content?.url || state.metadata?.url || state.metadata?.video_url || state.url;
        if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        return { status: "completed", result: { url, mimeType: "video/mp4" } };
    }
    if (status === "failed" || status === "cancelled" || status === "canceled" || status === "expired") {
        return { status: "failed", error: state.error?.message || `Seedance 视频生成${status === "expired" ? "超时" : "失败"}` };
    }
    return { status: "pending" };
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTaskResponse>) {
    if (!payload) throw new Error("Seedance 接口没有返回任务");
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(payload.msg || payload.message || "请求失败");
        if (!payload.data) throw new Error("Seedance 接口没有返回任务");
        return payload.data;
    }
    return payload as SeedanceTaskResponse;
}

function isProtectedVideoContentUrl(value: string) {
    try {
        return /\/v1\/videos\/[^/]+\/content$/.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    const providerMessage = payload.msg || payload.error?.message;
    if ((typeof payload.code === "number" && payload.code !== 0) || providerMessage) throw new Error(providerMessage || "Seedance 视频下载失败");
}
