import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { fixedGrokVideoResolution, grokVideoReferenceImageLimit, isGrokVideoModel, normalizeReferenceVideoSeconds, preferredGrokVideoModel, supportsGrokVideoReferenceCount } from "@/lib/video-model-settings";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    const model = referenceImageCount ? selectReferenceImageVideoModel(config, referenceImageCount) : config.videoModel || config.model;
    const nextConfig = model && (model !== config.model || model !== config.videoModel) ? { ...config, model, videoModel: model } : config;
    const effectiveReferenceCount = Math.min(referenceImageCount, grokVideoReferenceImageLimit(model || nextConfig.model));
    if (!isGrokReferenceVideoModel(model || nextConfig.model, effectiveReferenceCount)) return nextConfig;
    return {
        ...nextConfig,
        videoSeconds: normalizeReferenceVideoSeconds(nextConfig.videoSeconds, model || nextConfig.model, effectiveReferenceCount),
        vquality: fixedGrokVideoResolution(model || nextConfig.model) || nextConfig.vquality,
    };
}

export function selectReferenceImageVideoModel(config: AiConfig, referenceImageCount: number) {
    const currentModel = config.videoModel || config.model;
    if (!referenceImageCount || isGrokVideoModel(currentModel)) return currentModel;
    const grokModel = pickVideoModel(config, (model) => isGrokReferenceVideoModel(model, referenceImageCount));
    return grokModel || preferredGrokVideoModel();
}

function pickVideoModel(config: AiConfig, predicate: (model: string) => boolean) {
    return config.videoModels.find((model) => predicate(model) && matchesRequestedOrientation(model, config.size)) || config.videoModels.find(predicate);
}

function isGrokReferenceVideoModel(model: string, referenceImageCount: number) {
    return isGrokVideoModel(modelOptionName(model)) && supportsGrokVideoReferenceCount(model, referenceImageCount);
}

function matchesRequestedOrientation(model: string, size: string) {
    const value = modelOptionName(model).toLowerCase();
    if (size === "9:16") return value.includes("portrait") || (!value.includes("landscape") && !value.includes("16:9"));
    if (size === "16:9") return value.includes("landscape") || (!value.includes("portrait") && !value.includes("9:16"));
    return true;
}
