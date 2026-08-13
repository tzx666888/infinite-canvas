import {
    fixedGoogleVideoDurationOptions,
    fixedGoogleVideoResolution,
    googleVideoReferenceImageLimit,
    googleVideoReferenceMode,
    googleVideoEntryMode,
    isGoogleVideoModel,
    normalizeGoogleVideoSeconds,
    selectGoogleVideoReferenceImages,
    selectGoogleVideoReferenceImagesWithPriority,
    supportsGoogleVideoReferenceCount,
} from "@/lib/video-providers/google-video";
import {
    fixedGrokVideoDurationOptions,
    fixedGrokVideoResolution,
    grokVideoReferenceImageLimit,
    grokVideoReferenceMode,
    GROK_REFERENCE_VIDEO_MAX_SECONDS,
    isGrokVideoModel,
    selectGrokReferenceVideoImages,
    selectGrokReferenceVideoImagesWithPriority,
    supportsGrokVideoReferenceCount,
} from "@/lib/video-providers/grok-video";
import { fixedSeedanceVideoResolution, isSeedanceVideoModel, normalizeSeedanceDuration, seedanceDurationOptionsForModel, seedanceSupportsGeneratedAudio, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { isTokaxisMiniMaxH3VideoModel, MINIMAX_H3_REFERENCE_LIMITS, normalizeMiniMaxH3Duration } from "@/lib/minimax-h3-video";

export type { VideoAspectRatio, VideoReferenceMode } from "@/lib/video-providers/shared";
export { normalizeVideoModelId, videoAspectRatioForSize } from "@/lib/video-providers/shared";
export {
    GOOGLE_VIDEO_MODEL_IDS,
    googleVideoEntryInfo,
    googleVideoEntryMode,
    googleVideoEntryReferenceImageLimit,
    googleVideoReferenceImageLimit,
    googleVideoReferenceMode,
    googleVideoRouteAspectRatio,
    isGoogleVeoOfficialExtendDuration,
    isGoogleVideoModel,
    isOmniVideoModel,
    normalizeGoogleVideoSeconds,
    preferredGoogleVideoModel,
    resolveGoogleVideoRouteModelId,
    supportsGoogleVideoReferenceCount,
    type GoogleVideoEntryMode,
} from "@/lib/video-providers/google-video";
export {
    fixedGrokVideoResolution,
    grokVideoReferenceImageLimit,
    grokVideoReferenceMode,
    GROK_REFERENCE_VIDEO_MAX_IMAGES,
    GROK_REFERENCE_VIDEO_MAX_SECONDS,
    isGrok1080pVideoModel,
    isGrokVideoModel,
    preferredGrokVideoModel,
    selectGrokReferenceVideoImages,
    selectGrokReferenceVideoImagesWithPriority,
    supportsGrokVideoReferenceCount,
    type GrokVideoReferenceMode,
} from "@/lib/video-providers/grok-video";

export type VideoModelPromptProfile = "single-scene" | "image-anchor" | "multi-reference" | "first-last-frame" | "multimodal";

export type VideoModelCapabilityContract = {
    routeFamily: string;
    durations: readonly number[];
    durationRange?: readonly [number, number];
    sizes: readonly ("720x1280" | "1280x720")[];
    resolution: "480" | "720" | "1080" | "1440";
    referenceImageLimit: number;
    supportsGeneratedAudio: boolean;
    promptProfile: VideoModelPromptProfile;
};

/**
 * Agent、设置面板和生成前校验共同读取的模型能力契约。
 * 新模型接入视频 provider 后，只需在这里登记能力；Agent 不再维护自己的模型白名单。
 */
export function videoModelCapabilityContract(model: string): VideoModelCapabilityContract | null {
    if (!isCanvasVideoModel(model)) return null;
    const durations = fixedVideoDurationOptions(model) || (isTokaxisMiniMaxH3VideoModel(model) ? [5, 10, 15] : [6, 10, 15]);
    const resolution = fixedVideoResolution(model, durations[0]) || (isTokaxisMiniMaxH3VideoModel(model) ? "1440" : "720");
    const referenceImageLimit = videoReferenceImageLimit(model);
    const referenceMode = videoReferenceMode(model, Math.min(2, Math.max(1, referenceImageLimit)));
    const googleMode = googleVideoEntryMode(model);
    return {
        routeFamily: googleMode ? `google:${googleMode}` : `model:${model.trim().toLowerCase().split("::").at(-1) || model}`,
        durations,
        ...(isTokaxisMiniMaxH3VideoModel(model) ? { durationRange: [5, 15] as const } : {}),
        sizes: ["720x1280", "1280x720"],
        resolution,
        referenceImageLimit,
        supportsGeneratedAudio: isSeedanceVideoModel(model) ? seedanceSupportsGeneratedAudio(model) : isTokaxisMiniMaxH3VideoModel(model) || isGoogleVideoModel(model),
        promptProfile: isSeedanceVideoModel(model)
            ? "multimodal"
            : googleVideoEntryMode(model) === "veo-auto"
              ? "first-last-frame"
              : referenceMode === "r2v" || referenceImageLimit > 1
                ? "multi-reference"
                : referenceMode === "i2v"
                  ? "image-anchor"
                  : "single-scene",
    };
}

export function fixedVideoDurationOptions(model: string): readonly number[] | null {
    if (isSeedanceVideoModel(model)) return seedanceDurationOptionsForModel(model);
    return fixedGoogleVideoDurationOptions(model) || fixedGrokVideoDurationOptions(model);
}

export function isCanvasVideoModel(model: string) {
    return isGoogleVideoModel(model) || isGrokVideoModel(model) || isSeedanceVideoModel(model) || isTokaxisMiniMaxH3VideoModel(model);
}

export function fixedVideoResolution(model: string, duration?: string | number): "720" | "1080" | "1440" | null {
    if (isTokaxisMiniMaxH3VideoModel(model)) return "1440";
    return fixedGoogleVideoResolution(model, duration) || fixedGrokVideoResolution(model) || fixedSeedanceVideoResolution(model);
}

export function videoReferenceMode(model: string, referenceCount: number) {
    if (isSeedanceVideoModel(model) || isTokaxisMiniMaxH3VideoModel(model)) return referenceCount > 1 ? "r2v" : referenceCount === 1 ? "i2v" : "t2v";
    return isGoogleVideoModel(model) ? googleVideoReferenceMode(model, referenceCount) : grokVideoReferenceMode(model, referenceCount);
}

export function videoReferenceImageLimit(model: string) {
    if (isTokaxisMiniMaxH3VideoModel(model)) return MINIMAX_H3_REFERENCE_LIMITS.images;
    if (isSeedanceVideoModel(model)) return SEEDANCE_REFERENCE_LIMITS.images;
    return isGoogleVideoModel(model) ? googleVideoReferenceImageLimit(model) : grokVideoReferenceImageLimit(model);
}

export function supportsVideoReferenceCount(model: string, referenceImageCount: number) {
    if (isTokaxisMiniMaxH3VideoModel(model)) return referenceImageCount >= 0 && referenceImageCount <= MINIMAX_H3_REFERENCE_LIMITS.images;
    if (isSeedanceVideoModel(model)) return referenceImageCount >= 0 && referenceImageCount <= SEEDANCE_REFERENCE_LIMITS.images;
    return isGoogleVideoModel(model) ? supportsGoogleVideoReferenceCount(model, referenceImageCount) : supportsGrokVideoReferenceCount(model, referenceImageCount);
}

export function normalizeModelVideoSeconds(value: string, model: string) {
    if (isTokaxisMiniMaxH3VideoModel(model)) return String(normalizeMiniMaxH3Duration(value));
    if (isGoogleVideoModel(model)) return normalizeGoogleVideoSeconds(value, model);
    if (isSeedanceVideoModel(model)) return String(normalizeSeedanceDuration(value, model));
    const seconds = Math.floor(Number(value) || 6);
    const options = fixedVideoDurationOptions(model);
    if (!options) return String(Math.max(1, Math.min(20, seconds)));
    const nearest = options.reduce((best, candidate) => (Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best));
    return String(nearest);
}

export function normalizeReferenceVideoSeconds(value: string, model: string, referenceImageCount: number) {
    const seconds = Number(normalizeModelVideoSeconds(value, model));
    if (isGrokVideoModel(model) && referenceImageCount > 1) return String(Math.min(seconds, GROK_REFERENCE_VIDEO_MAX_SECONDS));
    return String(seconds);
}

export function selectVideoReferenceImages<T>(items: T[], model: string) {
    if (isTokaxisMiniMaxH3VideoModel(model)) return items.slice(0, MINIMAX_H3_REFERENCE_LIMITS.images);
    if (isSeedanceVideoModel(model)) return items.slice(0, SEEDANCE_REFERENCE_LIMITS.images);
    return isGoogleVideoModel(model) ? selectGoogleVideoReferenceImages(items, model) : selectGrokReferenceVideoImages(items, model);
}

export function selectVideoReferenceImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    if (isTokaxisMiniMaxH3VideoModel(model)) return [...priorityItems, ...timelineItems].slice(0, MINIMAX_H3_REFERENCE_LIMITS.images);
    if (isSeedanceVideoModel(model)) return [...priorityItems, ...timelineItems].slice(0, SEEDANCE_REFERENCE_LIMITS.images);
    return isGoogleVideoModel(model) ? selectGoogleVideoReferenceImagesWithPriority(priorityItems, timelineItems, model) : selectGrokReferenceVideoImagesWithPriority(priorityItems, timelineItems, model);
}
