import axios from "axios";

import type { VideoGenerationTask, VideoGenerationTaskState, VideoRequestOptions } from "@/services/api/video/provider-contract";

type VideoResponse = {
    id?: string;
    request_id?: string;
    status?: string;
    error?: { message?: string } | string;
    video?: { url?: string } | null;
    content?: { video_url?: string; url?: string } | null;
    video_url?: string;
    result_url?: string;
    url?: string;
    output?: string[];
};

type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string };

export async function createGoogleFlowVideoTaskRequest(input: {
    endpoint: string;
    headers: Record<string, string>;
    model: string;
    taskModel: string;
    prompt: string;
    seconds: string;
    size: string;
    resolution: string;
    files: File[];
    options?: VideoRequestOptions;
}): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", input.model);
    body.append("prompt", input.prompt);
    body.append("seconds", input.seconds);
    body.append("size", input.size);
    body.append("resolution_name", input.resolution);
    body.append("preset", "normal");
    input.files.forEach((file) => body.append("input_reference", file));

    const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(input.endpoint, body, { headers: input.headers, signal: input.options?.signal })).data);
    const taskId = created.id || created.request_id;
    if (!taskId) throw new Error("视频接口没有返回任务 ID");
    return { id: taskId, provider: "openai", model: input.taskModel };
}

export async function pollGoogleFlowVideoTaskRequest(input: { endpoint: string; contentEndpoint: string; headers: Record<string, string>; options?: VideoRequestOptions }): Promise<VideoGenerationTaskState> {
    const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(input.endpoint, { headers: input.headers, signal: input.options?.signal })).data);
    if (video.status === "completed" || video.status === "succeeded" || video.status === "done" || video.status === "success" || video.status === "finished") {
        const url = firstVideoUrl(video.video_url, video.result_url, video.url, video.output, video.content?.video_url, video.content?.url, video.video?.url);
        if (url && !isProtectedVideoContentUrl(url)) return { status: "completed", result: { url, mimeType: "video/mp4" } };
        const content = await axios.get<Blob>(input.contentEndpoint, { headers: input.headers, responseType: "blob", signal: input.options?.signal });
        await assertVideoBlob(content.data);
        return { status: "completed", result: { blob: content.data } };
    }
    if (video.status === "failed" || video.status === "cancelled" || video.status === "expired") return { status: "failed", error: readProviderTaskError(video.error, "视频生成失败") };
    return { status: "pending" };
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    if (!payload) throw new Error("接口没有返回视频任务");
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(payload.msg || payload.message || "请求失败");
        if (!payload.data) throw new Error("接口没有返回视频任务");
        return payload.data;
    }
    return payload as VideoResponse;
}

function readProviderTaskError(error: VideoResponse["error"] | string | undefined, fallback: string) {
    if (!error) return fallback;
    if (typeof error === "string") return error || fallback;
    return error.message || fallback;
}

function firstVideoUrl(...values: Array<string | string[] | undefined>) {
    let fallback = "";
    for (const value of values) {
        const url = firstHttpUrl(value);
        if (!url) continue;
        if (!isProtectedVideoContentUrl(url)) return url;
        fallback ||= url;
    }
    return fallback;
}

function firstHttpUrl(value: string | string[] | undefined): string {
    if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? value.trim() : "";
    if (Array.isArray(value)) return value.map(firstHttpUrl).find(Boolean) || "";
    return "";
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
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    const providerMessage = payload.msg || payload.error?.message;
    if (providerMessage) throw new Error(providerMessage);
}
