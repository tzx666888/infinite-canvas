export const TOKAXIS_VIDEO_ENHANCER_MODEL_IDS = ["1080", "1080pro"] as const;
const MODEL_SET = new Set<string>(TOKAXIS_VIDEO_ENHANCER_MODEL_IDS);

export function isTokaxisVideoEnhancerModel(model: string) {
    return MODEL_SET.has(model.trim().split("::").at(-1)?.toLowerCase() || "") || MODEL_SET.has(model.trim().split("::").at(-1) || "");
}
