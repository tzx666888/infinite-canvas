export const TOKAXIS_GPT_IMAGE_2_5_MODEL_IDS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;

const TOKAXIS_GPT_IMAGE_2_5_MODELS = new Set<string>(TOKAXIS_GPT_IMAGE_2_5_MODEL_IDS);

export const GPT_IMAGE_2_FAMILY_MAX_PIXELS = 8_294_400;

export function gptImageModelName(value: string) {
    return value.trim().toLowerCase().split("::").at(-1) || "";
}

export function isGptImage25Model(value: string) {
    return TOKAXIS_GPT_IMAGE_2_5_MODELS.has(gptImageModelName(value));
}

export function isGptImage2FamilyModel(value: string) {
    const model = gptImageModelName(value);
    return model === "gpt-image-2" || TOKAXIS_GPT_IMAGE_2_5_MODELS.has(model);
}
