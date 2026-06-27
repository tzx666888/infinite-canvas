import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    if (!referenceImageCount) return config;
    const model = selectReferenceImageVideoModel(config, referenceImageCount);
    const nextConfig = model && model !== config.model ? { ...config, model } : config;
    if (!isGrokReferenceVideoModel(model || nextConfig.model)) return nextConfig;
    return {
        ...nextConfig,
        videoSeconds: normalizeGrokReferenceVideoSeconds(nextConfig.videoSeconds),
        vquality: "720",
    };
}

export function selectReferenceImageVideoModel(config: AiConfig, referenceImageCount: number) {
    const currentModel = config.model || config.videoModel;
    if (!referenceImageCount || isGrokReferenceVideoModel(currentModel)) return currentModel;
    const grokModel = pickVideoModel(config, isGrokReferenceVideoModel);
    if (grokModel) return grokModel;
    if (supportsReferenceImageVideoModel(currentModel)) return currentModel;
    return pickVideoModel(config, isMultiReferenceVeoModel) || pickVideoModel(config, isImageReferenceVeoModel) || currentModel;
}

export function shouldUseVeoPromptForVideo(config: AiConfig, referenceImageCount: number) {
    return modelOptionName(config.model || config.videoModel).toLowerCase().includes("veo");
}

function pickVideoModel(config: AiConfig, predicate: (model: string) => boolean) {
    return config.videoModels.find((model) => predicate(model) && matchesRequestedOrientation(model, config.size)) || config.videoModels.find(predicate);
}

function supportsReferenceImageVideoModel(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return isGrokReferenceVideoModel(value) || isImageReferenceVeoModel(value) || value.includes("seedance");
}

function isGrokReferenceVideoModel(model: string) {
    return modelOptionName(model).toLowerCase() === "grok-imagine-video";
}

function normalizeGrokReferenceVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(10, seconds)));
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
