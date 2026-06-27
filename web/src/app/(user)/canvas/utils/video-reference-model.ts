import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    if (!referenceImageCount) return config;
    const model = selectReferenceImageVideoModel(config, referenceImageCount);
    return model && model !== config.model ? { ...config, model } : config;
}

export function selectReferenceImageVideoModel(config: AiConfig, referenceImageCount: number) {
    const currentModel = config.model || config.videoModel;
    if (!referenceImageCount || supportsReferenceImageVideoModel(currentModel)) return currentModel;
    return pickVideoModel(config, isMultiReferenceVeoModel) || pickVideoModel(config, isImageReferenceVeoModel) || currentModel;
}

export function shouldUseVeoPromptForVideo(config: AiConfig, referenceImageCount: number) {
    if (referenceImageCount > 0) return true;
    return modelOptionName(config.model || config.videoModel).toLowerCase().includes("veo");
}

function pickVideoModel(config: AiConfig, predicate: (model: string) => boolean) {
    return config.videoModels.find((model) => predicate(model) && matchesRequestedOrientation(model, config.size)) || config.videoModels.find(predicate);
}

function supportsReferenceImageVideoModel(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return isImageReferenceVeoModel(value) || value.includes("seedance");
}

function isMultiReferenceVeoModel(model: string) {
    return modelOptionName(model).toLowerCase().startsWith("veo_3_1_r2v");
}

function isImageReferenceVeoModel(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.startsWith("veo_3_1_r2v") || value.startsWith("veo_3_1_i2v");
}

function matchesRequestedOrientation(model: string, size: string) {
    const value = modelOptionName(model).toLowerCase();
    if (size === "9:16") return value.includes("portrait") || (!value.includes("landscape") && !value.includes("16:9"));
    if (size === "16:9") return value.includes("landscape") || (!value.includes("portrait") && !value.includes("9:16"));
    return true;
}
