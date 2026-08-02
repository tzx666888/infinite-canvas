export type VideoAspectRatio = "9:16" | "16:9" | "1:1";
export type VideoReferenceMode = "t2v" | "i2v" | "r2v";

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

export function normalizeVideoModelId(model: string) {
    return model.trim().toLowerCase().split("::").at(-1) || "";
}
