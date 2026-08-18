export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "google-flow" | "seedance" | "openai"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };
export type VideoRequestOptions = { signal?: AbortSignal; onTaskCreated?: (task: VideoGenerationTask) => void };
