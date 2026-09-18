import type { AiConfig } from "@/stores/use-config-store";
import { facebookVideoSourceSize } from "./facebook-media.ts";
import { H3_MIN_SECONDS, H3_MAX_SECONDS } from "./h3-billing.ts";

export const TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID = "MiniMaxH3-720p";
export const TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS = [TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID, "MiniMaxH3-2k"] as const;
const TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID_SET = new Set(TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS.map((model) => model.toLowerCase()));

/** The three tiers the station publishes; it owns any super-resolution behind them. */
export const PUBLIC_MINIMAX_H3_MODEL_IDS = new Set(["minimax-h3-720p", "minimax-h3-1080p", "minimax-h3-1080p-pro"]);

export function normalizeTokaxisMiniMaxH3Model(value: string) {
    const normalized = (value.trim().split("::").at(-1) || "").toLowerCase();
    // Public tiers go upstream untouched - the station maps them onto the base model.
    if (PUBLIC_MINIMAX_H3_MODEL_IDS.has(normalized)) return normalized;
    if (normalized === "minimaxh3-2k") return "MiniMaxH3-2k";
    if (normalized === "minimaxh3-720p") return "MiniMaxH3-720p";
    throw new Error(`不支持的 MiniMax H3 视频模型：${value || "(空)"}`);
}

export function tokaxisMiniMaxH3Resolution(value: string) {
    const normalized = (value.trim().split("::").at(-1) || "").toLowerCase();
    // Every public tier is generated at 768P; the 1080p tiers are upscaled upstream.
    if (PUBLIC_MINIMAX_H3_MODEL_IDS.has(normalized)) return "768P";
    if (normalized === "minimaxh3-2k") return "2K";
    if (normalized === "minimaxh3-720p") return "768P";
    throw new Error(`不支持的 MiniMax H3 视频模型：${value || "(空)"}`);
}

export const MINIMAX_H3_REFERENCE_LIMITS = {
    images: 5,
    audios: 3,
};

export function isTokaxisMiniMaxH3VideoModel(model: string) {
    const normalized = (model.trim().split("::").at(-1) || "").toLowerCase();
    return TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID_SET.has(normalized) || ["minimax-h3-720p", "minimax-h3-1080p", "minimax-h3-1080p-pro"].includes(normalized);
}

export function isMiniMaxH3VideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel">) {
    return isTokaxisMiniMaxH3VideoModel(config.videoModel || config.model);
}

export const MINIMAX_H3_DURATION_OPTIONS: readonly number[] = Array.from({ length: H3_MAX_SECONDS - H3_MIN_SECONDS + 1 }, (_, index) => H3_MIN_SECONDS + index);

export function normalizeMiniMaxH3Duration(value: string | number) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && value !== "" ? Math.max(H3_MIN_SECONDS, Math.min(H3_MAX_SECONDS, Math.floor(seconds))) : 10;
}

export function normalizeMiniMaxH3AspectRatio(value: string) {
    const normalized = facebookVideoSourceSize(value).trim().toLowerCase();
    if (normalized === "9:16" || normalized === "720x1280" || normalized === "1080x1920" || normalized === "1440x2560") return "9:16";
    return "16:9";
}

export type TokaxisMiniMaxH3PayloadInput = {
    model?: string;
    prompt: string;
    images?: string[];
    audios?: string[];
    duration: string | number;
    size: string;
    generateAudio: boolean;
};

export function buildTokaxisMiniMaxH3Payload(input: TokaxisMiniMaxH3PayloadInput): Record<string, unknown> {
    if (!input.prompt.trim()) throw new Error("MiniMax H3 需要视频提示词");
    if ((input.images?.length || 0) > MINIMAX_H3_REFERENCE_LIMITS.images) throw new Error(`MiniMax H3 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.images} 张参考图`);
    if ((input.audios?.length || 0) > MINIMAX_H3_REFERENCE_LIMITS.audios) throw new Error(`MiniMax H3 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.audios} 个参考音频`);
    if (input.audios?.length && !input.images?.length) throw new Error("MiniMax H3 参考音频需要同时提供参考图");
    const model = normalizeTokaxisMiniMaxH3Model(input.model || TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID);
    return {
        model,
        prompt: input.prompt.trim(),
        ...(input.images?.length ? { images: [...input.images] } : {}),
        ...(input.audios?.length ? { audios: [...input.audios] } : {}),
        duration: normalizeMiniMaxH3Duration(input.duration),
        resolution: tokaxisMiniMaxH3Resolution(model),
        aspect_ratio: normalizeMiniMaxH3AspectRatio(input.size),
        generate_audio: input.generateAudio,
    };
}
