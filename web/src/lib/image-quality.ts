const IMAGE_QUALITY_VALUES = new Set(["auto", "low", "medium", "high", "standard", "hd"]);

const IMAGE_QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};

export function normalizeImageQualityForModel(quality: string, model: string) {
    const value = quality.trim().toLowerCase();
    const normalized = IMAGE_QUALITY_ALIASES[value] || value;
    const modelName = model.trim().toLowerCase().split("::").at(-1) || "";

    if (/^gpt-image-2(?:-|$)/.test(modelName)) {
        if (normalized === "standard") return "low";
        if (normalized === "hd") return "high";
    }

    return IMAGE_QUALITY_VALUES.has(normalized) ? normalized : undefined;
}
