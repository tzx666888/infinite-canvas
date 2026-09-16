export type ProductVideoFamily = "minimax-h3" | "sd30" | "omni";
export type ProductVideoQuality = "720p" | "1080p" | "1080p-pro";

export type ProductVideoSpec = {
    id: string;
    family: ProductVideoFamily;
    quality: ProductVideoQuality;
    baseModel: string;
    enhancerModel?: "1080" | "1080pro";
};

const SPECS: ProductVideoSpec[] = [
    { id: "minimax-h3-720p", family: "minimax-h3", quality: "720p", baseModel: "MiniMaxH3-720p" },
    { id: "sd30-720p", family: "sd30", quality: "720p", baseModel: "sd30" },
    { id: "omni-720p", family: "omni", quality: "720p", baseModel: "omni" },
    { id: "minimax-h3-1080p", family: "minimax-h3", quality: "1080p", baseModel: "MiniMaxH3-720p", enhancerModel: "1080" },
    { id: "minimax-h3-1080p-pro", family: "minimax-h3", quality: "1080p-pro", baseModel: "MiniMaxH3-720p", enhancerModel: "1080pro" },
    { id: "sd30-1080p", family: "sd30", quality: "1080p", baseModel: "sd30", enhancerModel: "1080" },
    { id: "sd30-1080p-pro", family: "sd30", quality: "1080p-pro", baseModel: "sd30", enhancerModel: "1080pro" },
    { id: "omni-1080p", family: "omni", quality: "1080p", baseModel: "omni", enhancerModel: "1080" },
    { id: "omni-1080p-pro", family: "omni", quality: "1080p-pro", baseModel: "omni", enhancerModel: "1080pro" },
];

export const PRODUCT_VIDEO_MODEL_IDS = SPECS.map((item) => item.id) as readonly string[];
const SPEC_BY_ID = new Map(SPECS.map((item) => [item.id, item]));
const LEGACY_ALIASES = new Map<string, string>([
    ["minimaxh3-2k", "minimaxh3-2k"],
]);

export function normalizeProductVideoModel(value: string) {
    const raw = value.trim().split("::").at(-1)?.toLowerCase() || "";
    return LEGACY_ALIASES.get(raw) || raw;
}

export function productVideoSpec(value: string): ProductVideoSpec | null {
    return SPEC_BY_ID.get(normalizeProductVideoModel(value)) || null;
}

export function isProductVideoModel(value: string) {
    return Boolean(productVideoSpec(value));
}

export function productVideoBaseModel(value: string, portrait = false) {
    const spec = productVideoSpec(value);
    if (!spec) return "";
    if (spec.family === "omni") return portrait ? "omni_portrait" : "omni";
    return spec.baseModel;
}

/**
 * Productized Omni IDs keep their public ID on the wire so new-api can route
 * them to the 1080p orchestrator.  Only capability checks use the base Omni
 * policy; replacing the request model itself would silently bypass channel 50.
 */
export function productVideoFlowPolicyModel(value: string) {
    const spec = productVideoSpec(value);
    return spec?.family === "omni" ? "omni" : "";
}

export function productVideoNeedsEnhancement(value: string) {
    return productVideoSpec(value)?.enhancerModel || null;
}
