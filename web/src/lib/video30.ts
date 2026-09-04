import type { AiConfig } from "@/stores/use-config-store";

/**
 * 30 秒长视频（tokaxis 渠道 sd30）。
 *
 * 上游固定 30 秒，最多 9 张参考图，并按画面比例而不是分辨率描述输出。
 */
export const TOKAXIS_VIDEO30_MODEL_ID = "sd30";
export const TOKAXIS_VIDEO30_MODEL_IDS = [TOKAXIS_VIDEO30_MODEL_ID] as const;
const TOKAXIS_VIDEO30_MODEL_ID_SET = new Set(TOKAXIS_VIDEO30_MODEL_IDS.map((model) => model.toLowerCase()));

/** 画布时长选择器对该模型只显示 30 秒。 */
export const VIDEO30_DURATION_OPTIONS = [30] as const;

export const VIDEO30_REFERENCE_LIMITS = {
    images: 9,
};

export function isTokaxisVideo30Model(model: string) {
    return TOKAXIS_VIDEO30_MODEL_ID_SET.has((model.trim().split("::").at(-1) || "").toLowerCase());
}

export function isVideo30Config(config: AiConfig | Pick<AiConfig, "model" | "videoModel">) {
    return isTokaxisVideo30Model(config.videoModel || config.model);
}

/** 上游接受六种比例，其余值回退到 16:9。 */
export function normalizeVideo30Ratio(value: string) {
    const normalized = value.trim().toLowerCase();
    if (["9:16", "720x1280", "1080x1920", "portrait", "vertical"].includes(normalized)) return "9:16";
    if (["1:1", "square"].includes(normalized)) return "1:1";
    if (normalized === "3:4") return "3:4";
    if (normalized === "4:3") return "4:3";
    if (["21:9", "cinematic", "ultrawide"].includes(normalized)) return "21:9";
    return "16:9";
}
