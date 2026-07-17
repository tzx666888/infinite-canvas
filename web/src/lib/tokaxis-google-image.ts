export const TOKAXIS_GOOGLE_IMAGE_BASE_MODEL = "gemini-3.1-flash-image";

export const TOKAXIS_GOOGLE_IMAGE_SIZES = ["1K", "2K", "4K"] as const;
export type TokaxisGoogleImageSize = (typeof TOKAXIS_GOOGLE_IMAGE_SIZES)[number];

export const TOKAXIS_GOOGLE_IMAGE_MODELS: Record<TokaxisGoogleImageSize, string> = {
    "1K": `${TOKAXIS_GOOGLE_IMAGE_BASE_MODEL}-1k`,
    "2K": `${TOKAXIS_GOOGLE_IMAGE_BASE_MODEL}-2k`,
    "4K": `${TOKAXIS_GOOGLE_IMAGE_BASE_MODEL}-4k`,
};

export const TOKAXIS_GOOGLE_NATIVE_SIZES = {
    "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096" },
    "1:4": { "1K": "512x2048", "2K": "1024x4096", "4K": "2048x8192" },
    "1:8": { "1K": "384x3072", "2K": "768x6144", "4K": "1536x12288" },
    "2:3": { "1K": "848x1264", "2K": "1696x2528", "4K": "3392x5056" },
    "3:2": { "1K": "1264x848", "2K": "2528x1696", "4K": "5056x3392" },
    "3:4": { "1K": "896x1200", "2K": "1792x2400", "4K": "3584x4800" },
    "4:1": { "1K": "2048x512", "2K": "4096x1024", "4K": "8192x2048" },
    "4:3": { "1K": "1200x896", "2K": "2400x1792", "4K": "4800x3584" },
    "4:5": { "1K": "928x1152", "2K": "1856x2304", "4K": "3712x4608" },
    "5:4": { "1K": "1152x928", "2K": "2304x1856", "4K": "4608x3712" },
    "8:1": { "1K": "3072x384", "2K": "6144x768", "4K": "12288x1536" },
    "9:16": { "1K": "768x1376", "2K": "1536x2752", "4K": "3072x5504" },
    "16:9": { "1K": "1376x768", "2K": "2752x1536", "4K": "5504x3072" },
    "21:9": { "1K": "1584x672", "2K": "3168x1344", "4K": "6336x2688" },
} as const;

export type TokaxisGoogleAspectRatio = keyof typeof TOKAXIS_GOOGLE_NATIVE_SIZES;

export function tokaxisGoogleModelName(value: string) {
    return value.trim().split("::").at(-1)?.toLowerCase() || "";
}

export function isTokaxisGoogleImageModel(value: string) {
    const model = tokaxisGoogleModelName(value);
    return model === TOKAXIS_GOOGLE_IMAGE_BASE_MODEL || Object.values(TOKAXIS_GOOGLE_IMAGE_MODELS).includes(model);
}

export function tokaxisGoogleImageSizeFromModel(value: string): TokaxisGoogleImageSize | undefined {
    const model = tokaxisGoogleModelName(value);
    return TOKAXIS_GOOGLE_IMAGE_SIZES.find((size) => TOKAXIS_GOOGLE_IMAGE_MODELS[size] === model);
}

export function tokaxisGoogleModelForSize(value: string, imageSize: TokaxisGoogleImageSize) {
    const separator = value.lastIndexOf("::");
    const prefix = separator >= 0 ? value.slice(0, separator + 2) : "";
    return `${prefix}${TOKAXIS_GOOGLE_IMAGE_MODELS[imageSize]}`;
}

export function tokaxisGoogleImageSizeFromDimensions(value?: string): TokaxisGoogleImageSize | undefined {
    if (!value) return undefined;
    for (const sizes of Object.values(TOKAXIS_GOOGLE_NATIVE_SIZES)) {
        const match = TOKAXIS_GOOGLE_IMAGE_SIZES.find((imageSize) => sizes[imageSize] === value);
        if (match) return match;
    }
    const dimensions = parseDimensions(value);
    if (!dimensions) return undefined;
    const pixels = dimensions.width * dimensions.height;
    return pixels > 8_000_000 ? "4K" : pixels > 2_000_000 ? "2K" : "1K";
}

export function resolveTokaxisGoogleImageConfig(model: string, size?: string, quality?: string) {
    const modelSize = tokaxisGoogleImageSizeFromModel(model);
    const dimensionSize = tokaxisGoogleImageSizeFromDimensions(size);
    const qualitySize = tokaxisGoogleImageSizeFromQuality(quality);
    const imageSize = modelSize || dimensionSize || qualitySize || "1K";
    const aspectRatio = resolveAspectRatio(size);
    return { aspect_ratio: aspectRatio, image_size: imageSize };
}

function tokaxisGoogleImageSizeFromQuality(quality?: string): TokaxisGoogleImageSize | undefined {
    const value = quality?.trim().toLowerCase();
    if (["high", "hd", "4k"].includes(value || "")) return "4K";
    if (["medium", "2k"].includes(value || "")) return "2K";
    if (["low", "standard", "1k"].includes(value || "")) return "1K";
    return undefined;
}

function resolveAspectRatio(value?: string): TokaxisGoogleAspectRatio {
    if (value && value in TOKAXIS_GOOGLE_NATIVE_SIZES) return value as TokaxisGoogleAspectRatio;
    for (const [aspectRatio, sizes] of Object.entries(TOKAXIS_GOOGLE_NATIVE_SIZES) as Array<[TokaxisGoogleAspectRatio, Record<TokaxisGoogleImageSize, string>]>) {
        if (Object.values(sizes).includes(value || "")) return aspectRatio;
    }
    const dimensions = parseDimensions(value);
    if (!dimensions) return "1:1";
    const requestedRatio = dimensions.width / dimensions.height;
    return (Object.keys(TOKAXIS_GOOGLE_NATIVE_SIZES) as TokaxisGoogleAspectRatio[]).reduce((best, candidate) => {
        const [width, height] = candidate.split(":").map(Number);
        const [bestWidth, bestHeight] = best.split(":").map(Number);
        return Math.abs(Math.log(requestedRatio / (width / height))) < Math.abs(Math.log(requestedRatio / (bestWidth / bestHeight))) ? candidate : best;
    }, "1:1");
}

function parseDimensions(value?: string) {
    const match = value?.match(/^(\d+)x(\d+)$/i);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}
