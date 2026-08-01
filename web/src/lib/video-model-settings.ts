const GROK_DURATION_OPTIONS = [6, 10, 15] as const;
const GROK_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const GROK_IMAGE_REQUIRED_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const GROK_MULTI_REFERENCE_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview"]);
export const GROK_REFERENCE_VIDEO_MAX_IMAGES = 7;
export const GROK_REFERENCE_VIDEO_MAX_SECONDS = 10;
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
const GOOGLE_VIDEO_MODEL_ID_SET = new Set<string>(GOOGLE_VIDEO_MODEL_IDS);
const OMNI_VIDEO_MODEL_IDS = new Set(["omni", "omni_portrait"]);
const GOOGLE_VEO_DURATION_OPTIONS = [4, 6, 15] as const;
const GOOGLE_OMNI_DURATION_OPTIONS = [10] as const;
export type VideoAspectRatio = "9:16" | "16:9" | "1:1";
export type VideoReferenceMode = "t2v" | "i2v" | "r2v";
export type GrokVideoReferenceMode = VideoReferenceMode;

export function videoAspectRatioForSize(value: string): VideoAspectRatio {
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

export function fixedVideoDurationOptions(model: string): readonly number[] | null {
    const normalized = normalizeVideoModelId(model);
    if (OMNI_VIDEO_MODEL_IDS.has(normalized)) return GOOGLE_OMNI_DURATION_OPTIONS;
    if (GOOGLE_VIDEO_MODEL_ID_SET.has(normalized)) return GOOGLE_VEO_DURATION_OPTIONS;
    if (!GROK_VIDEO_MODEL_IDS.has(normalized)) return null;
    if (normalized === "grok-imagine-video-1.5-preview" || normalized === "grok-imagine-video-1.5-1080p") return [6, 10];
    return GROK_DURATION_OPTIONS;
}

export function isGrokVideoModel(model: string) {
    return GROK_VIDEO_MODEL_IDS.has(normalizeVideoModelId(model));
}

export function isGoogleVideoModel(model: string) {
    return GOOGLE_VIDEO_MODEL_ID_SET.has(normalizeVideoModelId(model));
}

export function isOmniVideoModel(model: string) {
    return OMNI_VIDEO_MODEL_IDS.has(normalizeVideoModelId(model));
}

export function isCanvasVideoModel(model: string) {
    return isGoogleVideoModel(model) || isGrokVideoModel(model);
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

export function fixedVideoResolution(model: string): "720" | "1080" | null {
    if (isGoogleVideoModel(model)) return "720";
    return fixedGrokVideoResolution(model);
}

export function googleVideoReferenceMode(model: string, referenceCount = 0): VideoReferenceMode {
    const normalized = normalizeVideoModelId(model);
    if (OMNI_VIDEO_MODEL_IDS.has(normalized)) return referenceCount > 0 ? "r2v" : "t2v";
    if (normalized.startsWith("veo_3_1_i2v")) return "i2v";
    if (normalized.startsWith("veo_3_1_r2v")) return "r2v";
    return "t2v";
}

export function videoReferenceMode(model: string, referenceCount: number): VideoReferenceMode {
    return isGoogleVideoModel(model) ? googleVideoReferenceMode(model, referenceCount) : grokVideoReferenceMode(model, referenceCount);
}

export function googleVideoReferenceImageLimit(model: string) {
    if (!isGoogleVideoModel(model)) return 0;
    if (isOmniVideoModel(model)) return 3;
    const mode = googleVideoReferenceMode(model);
    if (mode === "t2v") return 0;
    return mode === "i2v" ? 2 : 3;
}

export function videoReferenceImageLimit(model: string) {
    if (isGoogleVideoModel(model)) return googleVideoReferenceImageLimit(model);
    return grokVideoReferenceImageLimit(model);
}

export function supportsGoogleVideoReferenceCount(model: string, referenceImageCount: number) {
    if (!isGoogleVideoModel(model)) return false;
    if (isOmniVideoModel(model)) return referenceImageCount >= 0 && referenceImageCount <= 3;
    const mode = googleVideoReferenceMode(model, referenceImageCount);
    if (mode === "t2v") return referenceImageCount === 0;
    if (mode === "i2v") return referenceImageCount >= 1 && referenceImageCount <= 2;
    return referenceImageCount >= 1 && referenceImageCount <= 3;
}

export function supportsVideoReferenceCount(model: string, referenceImageCount: number) {
    if (isGoogleVideoModel(model)) return supportsGoogleVideoReferenceCount(model, referenceImageCount);
    return supportsGrokVideoReferenceCount(model, referenceImageCount);
}

export function preferredGoogleVideoModel(referenceImageCount = 1, aspectRatio: VideoAspectRatio = "9:16") {
    const portrait = aspectRatio !== "16:9";
    if (referenceImageCount <= 0) return `tokaxis::veo_3_1_t2v_fast_${portrait ? "portrait" : "landscape"}`;
    if (referenceImageCount <= 2) return portrait ? "tokaxis::veo_3_1_i2v_s_fast_portrait_fl" : "tokaxis::veo_3_1_i2v_s_fast_fl";
    return `tokaxis::veo_3_1_r2v_fast_${portrait ? "portrait" : "landscape"}`;
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

export function normalizeModelVideoSeconds(value: string, model: string) {
    const seconds = Math.floor(Number(value) || 6);
    const options = fixedVideoDurationOptions(model);
    if (!options) return String(Math.max(1, Math.min(20, seconds)));

    const nearest = options.reduce((best, candidate) => (Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best));
    return String(nearest);
}

export function normalizeReferenceVideoSeconds(value: string, model: string, referenceImageCount: number) {
    const seconds = Number(normalizeModelVideoSeconds(value, model));
    // One image uses image-to-video (up to 15s). Multiple images use Grok's
    // reference-to-video mode, whose official duration limit is 10 seconds.
    if (isGrokVideoModel(model) && referenceImageCount > 1) return String(Math.min(seconds, GROK_REFERENCE_VIDEO_MAX_SECONDS));
    return String(seconds);
}

export function selectVideoReferenceImages<T>(items: T[], model: string) {
    if (!isGoogleVideoModel(model)) return selectGrokReferenceVideoImages(items, model);
    const limit = googleVideoReferenceImageLimit(model);
    return items.length <= limit ? items : items.slice(0, limit);
}

export function selectVideoReferenceImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    if (!isGoogleVideoModel(model)) return selectGrokReferenceVideoImagesWithPriority(priorityItems, timelineItems, model);
    const combined = [...priorityItems, ...timelineItems];
    const limit = googleVideoReferenceImageLimit(model);
    if (combined.length <= limit) return combined;
    // Direct references are user choices and must reach validation unchanged.
    if (!timelineItems.length || limit <= 0) return combined;
    const priority = priorityItems.slice(0, Math.min(priorityItems.length, 1, limit));
    return [...priority, ...pickEvenly(timelineItems, limit - priority.length)];
}

export function selectGrokReferenceVideoImages<T>(items: T[], model: string) {
    const limit = grokVideoReferenceImageLimit(model);
    if (!isGrokVideoModel(model) || items.length <= limit) return items;
    if (limit === 1) return items.slice(0, 1);
    return pickEvenly(items, limit);
}

export function selectGrokReferenceVideoImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    const combined = [...priorityItems, ...timelineItems];
    const limit = grokVideoReferenceImageLimit(model);
    if (!isGrokVideoModel(model) || combined.length <= limit) return combined;
    // Preserve direct user references so the request layer can report an
    // over-limit error. Only storyboard timeline anchors are sampled.
    if (!timelineItems.length) return priorityItems;
    // 1080P has one image slot. Preserve an upstream identity/product
    // image when one exists; otherwise start from the first storyboard frame.
    // Picking the midpoint used to send panel 7 of a 12-panel sheet and made
    // the generated video begin halfway through the story.
    if (limit === 1) return priorityItems.length ? priorityItems.slice(0, 1) : timelineItems.slice(0, 1);
    const prioritySlots = Math.min(priorityItems.length, 1);
    const priority = priorityItems.slice(0, prioritySlots);
    const timeline = pickEvenly(timelineItems, limit - priority.length);
    return [...priority, ...timeline];
}

export function normalizeVideoModelId(model: string) {
    return model.trim().toLowerCase().split("::").at(-1) || "";
}

function pickEvenly<T>(items: T[], count: number) {
    if (items.length <= count) return items;
    if (count <= 0) return [];
    if (count === 1) return [items[Math.floor(items.length / 2)]];
    const lastIndex = items.length - 1;
    return Array.from({ length: count }, (_, index) => items[Math.round((index * lastIndex) / (count - 1))]);
}
