import type { VideoReferenceMode } from "@/lib/video-providers/shared";

const GROK_DURATION_OPTIONS = [6, 10, 15] as const;
const GROK_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const GROK_IMAGE_REQUIRED_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const GROK_MULTI_REFERENCE_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview"]);

export const GROK_REFERENCE_VIDEO_MAX_IMAGES = 7;
export const GROK_REFERENCE_VIDEO_MAX_SECONDS = 10;
export const GROK_DISABLED_VIDEO_MODEL_IDS = [
    "grok-image-video",
    "grok-video-1.5",
    "grok-imagine-video",
    "grok-imagine-1.0-video",
    "grok-imagine-1.0-video-16s",
    "grok-imagine-video-1.5-fast",
    "grok-imagine-video-1.5-preview",
    "grok-imagine-video-1.5-1080p",
    "grok-imagine-video-1.5-fast-16s",
    "grok-imagine-video-preview",
] as const;
export type GrokVideoReferenceMode = VideoReferenceMode;

export function fixedGrokVideoDurationOptions(model: string): readonly number[] | null {
    const normalized = normalizeVideoModelId(model);
    if (!GROK_VIDEO_MODEL_IDS.has(normalized)) return null;
    if (normalized === "grok-imagine-video-1.5-preview" || normalized === "grok-imagine-video-1.5-1080p") return [6, 10];
    return GROK_DURATION_OPTIONS;
}

export function isGrokVideoModel(model: string) {
    return GROK_VIDEO_MODEL_IDS.has(normalizeVideoModelId(model));
}

export function isGrok1080pVideoModel(model: string) {
    return normalizeVideoModelId(model) === "grok-imagine-video-1.5-1080p";
}

export function grokVideoReferenceMode(model: string, referenceCount: number): GrokVideoReferenceMode {
    if (!referenceCount) return "t2v";
    const normalized = normalizeVideoModelId(model);
    if (normalized === "grok-imagine-video-1.5-1080p") return "i2v";
    if (normalized === "grok-imagine-video-1.5-preview" || referenceCount > 1) return "r2v";
    return "i2v";
}

export function fixedGrokVideoResolution(model: string): "720" | "1080" | null {
    if (!isGrokVideoModel(model)) return null;
    return isGrok1080pVideoModel(model) ? "1080" : "720";
}

export function preferredGrokVideoModel() {
    return "tokaxis::grok-imagine-video-1.5-fast";
}

export function supportsGrokVideoReferenceCount(model: string, referenceImageCount: number) {
    const normalized = normalizeVideoModelId(model);
    if (!GROK_VIDEO_MODEL_IDS.has(normalized)) return false;
    if (!referenceImageCount) return !GROK_IMAGE_REQUIRED_VIDEO_MODEL_IDS.has(normalized);
    return referenceImageCount <= grokVideoReferenceImageLimit(model);
}

export function grokVideoReferenceImageLimit(model: string) {
    const normalized = normalizeVideoModelId(model);
    if (!GROK_VIDEO_MODEL_IDS.has(normalized)) return 0;
    return GROK_MULTI_REFERENCE_VIDEO_MODEL_IDS.has(normalized) ? GROK_REFERENCE_VIDEO_MAX_IMAGES : 1;
}

export function selectGrokReferenceVideoImages<T>(items: T[], model: string) {
    const limit = grokVideoReferenceImageLimit(model);
    if (!isGrokVideoModel(model) || items.length <= limit) return items;
    if (limit === 1) return items.slice(0, 1);
    return pickGrokVideoFramesEvenly(items, limit);
}

export function selectGrokReferenceVideoImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    const combined = [...priorityItems, ...timelineItems];
    const limit = grokVideoReferenceImageLimit(model);
    if (!isGrokVideoModel(model) || combined.length <= limit) return combined;
    // Preserve direct user references so the request layer can report an
    // over-limit error. Only storyboard timeline anchors are sampled.
    if (!timelineItems.length) return priorityItems;
    // 1080P has one image slot. Preserve an upstream identity/product image
    // when one exists; otherwise start from the first storyboard frame.
    if (limit === 1) return priorityItems.length ? priorityItems.slice(0, 1) : timelineItems.slice(0, 1);
    const prioritySlots = Math.min(priorityItems.length, 1);
    const priority = priorityItems.slice(0, prioritySlots);
    const timeline = pickGrokVideoFramesEvenly(timelineItems, limit - priority.length);
    return [...priority, ...timeline];
}

function normalizeVideoModelId(model: string) {
    return model.trim().toLowerCase().split("::").at(-1) || "";
}

function pickGrokVideoFramesEvenly<T>(items: T[], count: number) {
    if (items.length <= count) return items;
    if (count <= 0) return [];
    if (count === 1) return [items[Math.floor(items.length / 2)]];
    const lastIndex = items.length - 1;
    return Array.from({ length: count }, (_, index) => items[Math.round((index * lastIndex) / (count - 1))]);
}
