export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export class VideoTaskFailedError extends Error {}
export type VideoGenerationTask = { id: string; provider: "google-flow" | "seedance" | "video30" | "aliyun-enhancer" | "openai"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };
export type VideoRequestOptions = {
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
    onTaskCreated?: (task: VideoGenerationTask) => void;
    /** Public product id used for the single customer-facing billing reservation. */
    billingModel?: string;
    /** Correlates the base generation and its private enhancement hop. */
    requestId?: string;
};
