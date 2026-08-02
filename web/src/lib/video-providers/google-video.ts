import type { VideoAspectRatio, VideoReferenceMode } from "@/lib/video-providers/shared";

export const GOOGLE_VIDEO_MODEL_IDS = [
    "veo_3_1_t2v_fast_landscape",
    "veo_3_1_t2v_fast_portrait",
    "veo_3_1_i2v_s_fast_fl",
    "veo_3_1_i2v_s_fast_portrait_fl",
    "veo_3_1_r2v_fast_landscape",
    "veo_3_1_r2v_fast_portrait",
    "veo_3_1_r2v_fast",
    "omni",
    "omni_portrait",
] as const;
export const DEFAULT_GOOGLE_VIDEO_MODEL = "tokaxis::veo_3_1_i2v_s_fast_portrait_fl";

const GOOGLE_VIDEO_MODEL_ID_SET = new Set<string>(GOOGLE_VIDEO_MODEL_IDS);
const OMNI_VIDEO_MODEL_IDS = new Set(["omni", "omni_portrait"]);
const GOOGLE_VEO_DURATION_OPTIONS = [4, 6, 8] as const;
const GOOGLE_VEO_R2V_DURATION_OPTIONS = [8] as const;
const GOOGLE_OMNI_DURATION_OPTIONS = [10] as const;

export type GoogleVideoEntryMode = "veo-auto" | "veo-r2v" | "omni";

const GOOGLE_VIDEO_ENTRY_INFO: Record<GoogleVideoEntryMode, { label: string; description: string; badge?: string }> = {
    "veo-auto": { label: "Veo 3.1 智能生成", description: "4/6/8 秒 · 1080p；无图文生、1 张首帧、2 张首尾帧", badge: "Google" },
    "veo-r2v": { label: "Veo 3.1 多参考", description: "固定 8 秒 · 1080p；需 1–3 张人物、产品或场景参考图", badge: "Google" },
    omni: { label: "Omni 智能创作", description: "固定 10 秒 · 720p；文字或 1–3 张参考图", badge: "Google" },
};

export function fixedGoogleVideoDurationOptions(model: string): readonly number[] | null {
    const normalized = normalizeVideoModelId(model);
    if (OMNI_VIDEO_MODEL_IDS.has(normalized)) return GOOGLE_OMNI_DURATION_OPTIONS;
    if (normalized.startsWith("veo_3_1_r2v")) return GOOGLE_VEO_R2V_DURATION_OPTIONS;
    return GOOGLE_VIDEO_MODEL_ID_SET.has(normalized) ? GOOGLE_VEO_DURATION_OPTIONS : null;
}

export function fixedGoogleVideoResolution(model: string): "720" | "1080" | null {
    const normalized = normalizeVideoModelId(model);
    if (OMNI_VIDEO_MODEL_IDS.has(normalized)) return "720";
    return GOOGLE_VIDEO_MODEL_ID_SET.has(normalized) ? "1080" : null;
}

export function normalizeGoogleVideoSeconds(value: string, model: string) {
    const seconds = Math.floor(Number(value) || 6);
    const options = fixedGoogleVideoDurationOptions(model);
    if (!options) return String(Math.max(1, Math.min(20, seconds)));
    const nearest = options.reduce((best, candidate) => (Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best));
    return String(nearest);
}

export function isGoogleVideoModel(model: string) {
    return GOOGLE_VIDEO_MODEL_ID_SET.has(normalizeVideoModelId(model));
}

export function isOmniVideoModel(model: string) {
    return OMNI_VIDEO_MODEL_IDS.has(normalizeVideoModelId(model));
}

export function googleVideoModelDisplayName(model: string) {
    const normalized = normalizeVideoModelId(model);
    if (normalized === "omni" || normalized === "omni_portrait") return normalized === "omni" ? "Omni 横屏视频" : "Omni 竖屏视频";
    if (normalized.startsWith("veo_3_1_t2v")) return "Veo 3.1 文生视频";
    if (normalized.startsWith("veo_3_1_i2v")) return "Veo 3.1 首尾帧视频";
    if (normalized.startsWith("veo_3_1_r2v")) return "Veo 3.1 多参考视频";
    return "当前 Google 视频模型";
}

export function googleVideoEntryMode(model: string): GoogleVideoEntryMode | null {
    const normalized = normalizeVideoModelId(model);
    if (OMNI_VIDEO_MODEL_IDS.has(normalized)) return "omni";
    if (normalized.startsWith("veo_3_1_r2v")) return "veo-r2v";
    if (normalized.startsWith("veo_3_1_t2v") || normalized.startsWith("veo_3_1_i2v")) return "veo-auto";
    return null;
}

export function googleVideoEntryInfo(model: string) {
    const mode = googleVideoEntryMode(model);
    return mode ? GOOGLE_VIDEO_ENTRY_INFO[mode] : null;
}

export function googleVideoEntryReferenceImageLimit(model: string) {
    const mode = googleVideoEntryMode(model);
    if (mode === "veo-auto") return 2;
    if (mode === "veo-r2v" || mode === "omni") return 3;
    return 0;
}

export function googleVideoRouteAspectRatio(model: string, requestedSize: string): Exclude<VideoAspectRatio, "1:1"> {
    const requested = googleVideoAspectRatioForSize(requestedSize);
    if (requested !== "1:1") return requested;
    const normalized = normalizeVideoModelId(model);
    return normalized.includes("landscape") || normalized === "omni" || normalized === "veo_3_1_r2v_fast" ? "16:9" : "9:16";
}

export function resolveGoogleVideoRouteModelId(model: string, referenceImageCount: number, aspectRatio: Exclude<VideoAspectRatio, "1:1">) {
    const mode = googleVideoEntryMode(model);
    if (!mode) throw new Error("当前选择不是可用的 Google 视频入口");
    const count = Math.max(0, Math.floor(referenceImageCount));
    const portrait = aspectRatio === "9:16";

    if (mode === "veo-auto") {
        if (count > 2) throw new Error("Veo 智能生成最多支持 2 张参考图；3 张素材请切换到 Veo 3.1 多参考");
        if (count === 0) return `veo_3_1_t2v_fast_${portrait ? "portrait" : "landscape"}`;
        return portrait ? "veo_3_1_i2v_s_fast_portrait_fl" : "veo_3_1_i2v_s_fast_fl";
    }
    if (mode === "veo-r2v") {
        if (count < 1) throw new Error("Veo 3.1 多参考需要连接 1–3 张参考图");
        if (count > 3) throw new Error("Veo 3.1 多参考最多支持 3 张参考图");
        return `veo_3_1_r2v_fast_${portrait ? "portrait" : "landscape"}`;
    }
    if (count > 3) throw new Error("Omni 智能创作最多支持 3 张参考图");
    return portrait ? "omni_portrait" : "omni";
}

export function googleVideoReferenceMode(model: string, referenceCount = 0): VideoReferenceMode {
    const normalized = normalizeVideoModelId(model);
    if (OMNI_VIDEO_MODEL_IDS.has(normalized)) return referenceCount > 0 ? "r2v" : "t2v";
    if (normalized.startsWith("veo_3_1_i2v")) return "i2v";
    if (normalized.startsWith("veo_3_1_r2v")) return "r2v";
    return "t2v";
}

export function googleVideoReferenceImageLimit(model: string) {
    if (!isGoogleVideoModel(model)) return 0;
    if (isOmniVideoModel(model)) return 3;
    const mode = googleVideoReferenceMode(model);
    if (mode === "t2v") return 0;
    return mode === "i2v" ? 2 : 3;
}

export function supportsGoogleVideoReferenceCount(model: string, referenceImageCount: number) {
    if (!isGoogleVideoModel(model)) return false;
    if (isOmniVideoModel(model)) return referenceImageCount >= 0 && referenceImageCount <= 3;
    const mode = googleVideoReferenceMode(model, referenceImageCount);
    if (mode === "t2v") return referenceImageCount === 0;
    if (mode === "i2v") return referenceImageCount >= 1 && referenceImageCount <= 2;
    return referenceImageCount >= 1 && referenceImageCount <= 3;
}

export function preferredGoogleVideoModel(referenceImageCount = 1, aspectRatio: VideoAspectRatio = "9:16") {
    const portrait = aspectRatio !== "16:9";
    if (referenceImageCount <= 0) return `tokaxis::veo_3_1_t2v_fast_${portrait ? "portrait" : "landscape"}`;
    if (referenceImageCount <= 2) return portrait ? "tokaxis::veo_3_1_i2v_s_fast_portrait_fl" : "tokaxis::veo_3_1_i2v_s_fast_fl";
    return `tokaxis::veo_3_1_r2v_fast_${portrait ? "portrait" : "landscape"}`;
}

export function selectGoogleVideoReferenceImages<T>(items: T[], model: string) {
    const limit = googleVideoReferenceImageLimit(model);
    return items.length <= limit ? items : items.slice(0, limit);
}

export function selectGoogleVideoReferenceImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    const combined = [...priorityItems, ...timelineItems];
    const limit = googleVideoReferenceImageLimit(model);
    if (combined.length <= limit) return combined;
    // Direct references are user choices and must reach validation unchanged.
    if (!timelineItems.length || limit <= 0) return combined;
    const priority = priorityItems.slice(0, Math.min(priorityItems.length, 1, limit));
    return [...priority, ...pickGoogleVideoFramesEvenly(timelineItems, limit - priority.length)];
}

function normalizeVideoModelId(model: string) {
    return model.trim().toLowerCase().split("::").at(-1) || "";
}

function googleVideoAspectRatioForSize(value: string): VideoAspectRatio {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1:1" || normalized === "square") return "1:1";
    if (["16:9", "4:3", "landscape"].includes(normalized)) return "16:9";
    if (["9:16", "2:3", "3:4", "portrait", "auto", ""].includes(normalized)) return "9:16";
    const dimensions = /^(\d+)x(\d+)$/.exec(normalized);
    if (!dimensions) return "9:16";
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (Math.abs(width - height) / Math.max(width, height) <= 0.02) return "1:1";
    return width > height ? "16:9" : "9:16";
}

function pickGoogleVideoFramesEvenly<T>(items: T[], count: number) {
    if (items.length <= count) return items;
    if (count <= 0) return [];
    if (count === 1) return [items[Math.floor(items.length / 2)]];
    const lastIndex = items.length - 1;
    return Array.from({ length: count }, (_, index) => items[Math.round((index * lastIndex) / (count - 1))]);
}
