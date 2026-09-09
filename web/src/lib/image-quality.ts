import { isGptImage25Model, isGptImage2FamilyModel } from "./gpt-image.ts";

const IMAGE_QUALITY_VALUES = new Set(["auto", "low", "medium", "high", "standard", "hd"]);
const GPT_IMAGE_2_5_QUALITY_VALUES = new Set([...IMAGE_QUALITY_VALUES, "xhigh", "max"]);

const BASE_IMAGE_QUALITY_OPTIONS = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];
const GPT_IMAGE_2_5_QUALITY_OPTIONS = [
    ...BASE_IMAGE_QUALITY_OPTIONS,
    { value: "xhigh", label: "极高" },
    { value: "max", label: "最高" },
];

const IMAGE_QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};

export function normalizeImageQualityForModel(quality: string, model: string) {
    const value = quality.trim().toLowerCase();
    const normalized = IMAGE_QUALITY_ALIASES[value] || value;
    const modelName = model.trim().toLowerCase().split("::").at(-1) || "";

    if (isGptImage2FamilyModel(modelName)) {
        if (normalized === "standard") return "low";
        if (normalized === "hd") return "high";
    }

    const supportedValues = isGptImage25Model(modelName) ? GPT_IMAGE_2_5_QUALITY_VALUES : IMAGE_QUALITY_VALUES;
    return supportedValues.has(normalized) ? normalized : undefined;
}

export function imageQualityOptionsForModel(model: string) {
    return isGptImage25Model(model) ? GPT_IMAGE_2_5_QUALITY_OPTIONS : BASE_IMAGE_QUALITY_OPTIONS;
}
