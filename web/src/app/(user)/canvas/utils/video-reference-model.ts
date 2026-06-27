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
    return grokModel || "default::grok-imagine-video";
}

function pickVideoModel(config: AiConfig, predicate: (model: string) => boolean) {
    return config.videoModels.find((model) => predicate(model) && matchesRequestedOrientation(model, config.size)) || config.videoModels.find(predicate);
}

function isGrokReferenceVideoModel(model: string) {
    return modelOptionName(model).toLowerCase() === "grok-imagine-video";
}

function normalizeGrokReferenceVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(10, seconds)));
}

function matchesRequestedOrientation(model: string, size: string) {
    const value = modelOptionName(model).toLowerCase();
    if (size === "9:16") return value.includes("portrait") || (!value.includes("landscape") && !value.includes("16:9"));
    if (size === "16:9") return value.includes("landscape") || (!value.includes("portrait") && !value.includes("9:16"));
    return true;
}
