const GROK_DURATION_OPTIONS = [6, 10, 15] as const;
export const GROK_REFERENCE_VIDEO_MAX_IMAGES = 7;
export const GROK_REFERENCE_VIDEO_MAX_SECONDS = 10;

export function fixedVideoDurationOptions(model: string): readonly number[] | null {
    const normalized = model.trim().toLowerCase().split("::").at(-1) || "";
    if (normalized === "grok-imagine-video") return GROK_DURATION_OPTIONS;
    return null;
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
    if (!isGrokVideoModel(model) || items.length <= GROK_REFERENCE_VIDEO_MAX_IMAGES) return items;
    return pickEvenly(items, GROK_REFERENCE_VIDEO_MAX_IMAGES);
}

export function selectGrokReferenceVideoImagesWithPriority<T>(priorityItems: T[], timelineItems: T[], model: string) {
    const combined = [...priorityItems, ...timelineItems];
    if (!isGrokVideoModel(model) || combined.length <= GROK_REFERENCE_VIDEO_MAX_IMAGES) return combined;
    if (!timelineItems.length) return selectGrokReferenceVideoImages(priorityItems, model);
    const prioritySlots = Math.min(priorityItems.length, 1);
    const priority = priorityItems.slice(0, prioritySlots);
    const timeline = pickEvenly(timelineItems, GROK_REFERENCE_VIDEO_MAX_IMAGES - priority.length);
    return [...priority, ...timeline];
}

function isGrokVideoModel(model: string) {
    return (model.trim().toLowerCase().split("::").at(-1) || "") === "grok-imagine-video";
}

function pickEvenly<T>(items: T[], count: number) {
    if (items.length <= count) return items;
    if (count <= 0) return [];
    if (count === 1) return [items[Math.floor(items.length / 2)]];
    const lastIndex = items.length - 1;
    return Array.from({ length: count }, (_, index) => items[Math.round((index * lastIndex) / (count - 1))]);
}
