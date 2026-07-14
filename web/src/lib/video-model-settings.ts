const GROK_DURATION_OPTIONS = [6, 10, 15] as const;
const GROK_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const GROK_IMAGE_REQUIRED_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"]);
const GROK_MULTI_REFERENCE_VIDEO_MODEL_IDS = new Set(["grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview"]);
export const GROK_REFERENCE_VIDEO_MAX_IMAGES = 7;
export const GROK_REFERENCE_VIDEO_MAX_SECONDS = 10;
export type VideoAspectRatio = "9:16" | "16:9" | "1:1";
export type GrokVideoReferenceMode = "t2v" | "i2v" | "r2v";

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
    const normalized = model.trim().toLowerCase().split("::").at(-1) || "";
    if (!GROK_VIDEO_MODEL_IDS.has(normalized)) return null;
    if (normalized === "grok-imagine-video-1.5-preview" || normalized === "grok-imagine-video-1.5-1080p") return [6, 10];
    return GROK_DURATION_OPTIONS;
}

export function isGrokVideoModel(model: string) {
    return GROK_VIDEO_MODEL_IDS.has(model.trim().toLowerCase().split("::").at(-1) || "");
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

function normalizeVideoModelId(model: string) {
    return model.trim().toLowerCase().split("::").at(-1) || "";
}

function pickEvenly<T>(items: T[], count: number) {
    if (items.length <= count) return items;
    if (count <= 0) return [];
    if (count === 1) return [items[Math.floor(items.length / 2)]];
    const lastIndex = items.length - 1;
    return Array.from({ length: count }, (_, index) => items[Math.round((index * lastIndex) / (count - 1))]);
}
