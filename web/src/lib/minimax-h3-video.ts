import type { AiConfig } from "@/stores/use-config-store";

export const TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID = "MiniMax-H3-c4";
export const MINIMAX_H3_REFERENCE_LIMITS = {
    images: 5,
    audios: 3,
};

export function isTokaxisMiniMaxH3VideoModel(model: string) {
    return (model.trim().split("::").at(-1) || "").toLowerCase() === TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID.toLowerCase();
}

export function isMiniMaxH3VideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel">) {
    return isTokaxisMiniMaxH3VideoModel(config.videoModel || config.model);
}

export function normalizeMiniMaxH3Duration(value: string | number) {
    return Math.max(5, Math.min(15, Math.floor(Number(value) || 5)));
}

export function normalizeMiniMaxH3AspectRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "9:16" || normalized === "720x1280" || normalized === "1080x1920" || normalized === "1440x2560") return "9:16";
    return "16:9";
}

export type TokaxisMiniMaxH3PayloadInput = {
    prompt: string;
    images?: string[];
    audios?: string[];
    duration: string | number;
    size: string;
    generateAudio: boolean;
};

export function buildTokaxisMiniMaxH3Payload(input: TokaxisMiniMaxH3PayloadInput): Record<string, unknown> {
    if (!input.prompt.trim()) throw new Error("MiniMax-H3-c4 需要视频提示词");
    if ((input.images?.length || 0) > MINIMAX_H3_REFERENCE_LIMITS.images) throw new Error(`MiniMax-H3-c4 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.images} 张参考图`);
    if ((input.audios?.length || 0) > MINIMAX_H3_REFERENCE_LIMITS.audios) throw new Error(`MiniMax-H3-c4 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.audios} 个参考音频`);
    if (input.audios?.length && !input.images?.length) throw new Error("MiniMax-H3-c4 参考音频需要同时提供参考图");
    return {
        model: TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID,
        prompt: input.prompt.trim(),
        ...(input.images?.length ? { images: [...input.images] } : {}),
        ...(input.audios?.length ? { audios: [...input.audios] } : {}),
        duration: normalizeMiniMaxH3Duration(input.duration),
        resolution: "1440P",
        aspect_ratio: normalizeMiniMaxH3AspectRatio(input.size),
        generate_audio: input.generateAudio,
    };
}
