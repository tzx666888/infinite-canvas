export const NANO_BANANA_MODELS = ["nano-banana", "nano-banana-2"] as const;

export type NanoBananaModel = (typeof NANO_BANANA_MODELS)[number];
export type NanoBananaResolution = "1k" | "2k" | "4k";

export function isNanoBananaModel(model: string): model is NanoBananaModel {
    return NANO_BANANA_MODELS.includes(model.trim().toLowerCase() as NanoBananaModel);
}

export function resolveNanoBananaRequestModel(model: string, quality?: string, size?: string) {
    const normalizedModel = model.trim().toLowerCase();
    if (!isNanoBananaModel(normalizedModel)) return model;
    return `${normalizedModel}-${resolveNanoBananaResolution(quality, size)}`;
}

export function resolveNanoBananaResolution(quality?: string, size?: string): NanoBananaResolution {
    const normalizedSize = String(size || "").trim().toLowerCase();
    const dimensions = normalizedSize.match(/^(\d+)\s*x\s*(\d+)$/);
    const longEdge = dimensions ? Math.max(Number(dimensions[1]), Number(dimensions[2])) : 0;
    const shortEdge = dimensions ? Math.min(Number(dimensions[1]), Number(dimensions[2])) : 0;

    if (normalizedSize.includes("4k") || longEdge >= 3840) return "4k";
    if (normalizedSize.includes("2k") || shortEdge >= 1152) return "2k";
    return "1k";
}
