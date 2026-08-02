import {
    fixedGoogleVideoDurationOptions,
    fixedGoogleVideoResolution,
    googleVideoReferenceImageLimit,
    googleVideoReferenceMode,
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
    isGoogleVeoRelayDuration,
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

export function fixedVideoDurationOptions(model: string): readonly number[] | null {
    return fixedGoogleVideoDurationOptions(model) || fixedGrokVideoDurationOptions(model);
}

export function isCanvasVideoModel(model: string) {
    return isGoogleVideoModel(model) || isGrokVideoModel(model);
}

export function fixedVideoResolution(model: string): "720" | "1080" | null {
    return fixedGoogleVideoResolution(model) || fixedGrokVideoResolution(model);
}

export function videoReferenceMode(model: string, referenceCount: number) {
    return isGoogleVideoModel(model) ? googleVideoReferenceMode(model, referenceCount) : grokVideoReferenceMode(model, referenceCount);
}

export function videoReferenceImageLimit(model: string) {
    return isGoogleVideoModel(model) ? googleVideoReferenceImageLimit(model) : grokVideoReferenceImageLimit(model);
}

export function supportsVideoReferenceCount(model: string, referenceImageCount: number) {
    return isGoogleVideoModel(model) ? supportsGoogleVideoReferenceCount(model, referenceImageCount) : supportsGrokVideoReferenceCount(model, referenceImageCount);
}

export function normalizeModelVideoSeconds(value: string, model: string) {
    if (isGoogleVideoModel(model)) return normalizeGoogleVideoSeconds(value, model);
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
    return isGoogleVideoModel(model) ? selectGoogleVideoReferenceImages(items, model) : selectGrokReferenceVideoImages(items, model);
}

export function selectVideoReferenceImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    return isGoogleVideoModel(model) ? selectGoogleVideoReferenceImagesWithPriority(priorityItems, timelineItems, model) : selectGrokReferenceVideoImagesWithPriority(priorityItems, timelineItems, model);
}
