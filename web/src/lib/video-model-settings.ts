const GROK_DURATION_OPTIONS = [15] as const;

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
