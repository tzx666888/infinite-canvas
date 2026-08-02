import axios from "axios";

import type { VideoGenerationTask, VideoGenerationTaskState, VideoRequestOptions } from "@/services/api/video/provider-contract";

type SeedanceTaskResponse = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};

type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string };

export async function createSeedanceVideoTaskRequest(input: { endpoint: string; headers: Record<string, string>; model: string; payload: Record<string, unknown>; options?: VideoRequestOptions }): Promise<VideoGenerationTask> {
    const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTaskResponse>>(input.endpoint, input.payload, { headers: input.headers, signal: input.options?.signal })).data);
    if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
    return { id: created.id, provider: "seedance", model: input.model };
}

export async function pollSeedanceVideoTaskRequest(input: { endpoint: string; headers: Record<string, string>; options?: VideoRequestOptions }): Promise<VideoGenerationTaskState> {
    const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTaskResponse>>(input.endpoint, { headers: input.headers, signal: input.options?.signal })).data);
    if (state.status === "succeeded") {
        const url = state.content?.video_url;
        if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        return { status: "completed", result: { url, mimeType: "video/mp4" } };
    }
    if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: state.error?.message || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
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
