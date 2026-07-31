import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import {
    fixedVideoResolution,
    isGoogleVideoModel,
    isOmniVideoModel,
    normalizeReferenceVideoSeconds,
    preferredGoogleVideoModel,
    supportsGoogleVideoReferenceCount,
    videoAspectRatioForSize,
    videoReferenceImageLimit,
} from "@/lib/video-model-settings";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    const model = selectReferenceImageVideoModel(config, referenceImageCount);
    const nextConfig = model && (model !== config.model || model !== config.videoModel) ? { ...config, model, videoModel: model } : config;
    const effectiveReferenceCount = Math.min(referenceImageCount, Math.max(0, videoReferenceImageLimit(model || nextConfig.model)));
    if (!isGoogleVideoModel(model || nextConfig.model)) return nextConfig;
    return {
        ...nextConfig,
        videoSeconds: normalizeReferenceVideoSeconds(nextConfig.videoSeconds, model || nextConfig.model, effectiveReferenceCount),
        vquality: fixedVideoResolution(model || nextConfig.model) || nextConfig.vquality,
        size: googleVideoSize(model || nextConfig.model, nextConfig.size),
    };
}

export function selectReferenceImageVideoModel(config: AiConfig, referenceImageCount: number) {
    const currentModel = config.videoModel || config.model;
    const effectiveReferenceCount = Math.min(referenceImageCount, 3);
    if (isOmniVideoModel(currentModel) || (isGoogleVideoModel(currentModel) && supportsGoogleVideoReferenceCount(currentModel, effectiveReferenceCount))) return currentModel;
    const googleModel = pickVideoModel(config, (model) => isGoogleVideoModel(modelOptionName(model)) && supportsGoogleVideoReferenceCount(model, effectiveReferenceCount));
    return googleModel || preferredGoogleVideoModel(effectiveReferenceCount, videoAspectRatioForSize(config.size));
}

function pickVideoModel(config: AiConfig, predicate: (model: string) => boolean) {
    return config.videoModels.find((model) => predicate(model) && matchesRequestedOrientation(model, config.size)) || config.videoModels.find(predicate);
}

function matchesRequestedOrientation(model: string, size: string) {
    const value = modelOptionName(model).toLowerCase();
    if (size === "9:16") return value.includes("portrait") || (!value.includes("landscape") && !value.includes("16:9"));
    if (size === "16:9") return value.includes("landscape") || (!value.includes("portrait") && !value.includes("9:16"));
    const dimensions = /^(\d+)x(\d+)$/.exec(size);
    if (dimensions) return Number(dimensions[2]) > Number(dimensions[1]) ? value.includes("portrait") : value.includes("landscape") || !value.includes("portrait");
    return value.includes("portrait") || (!value.includes("landscape") && value === "veo_3_1_r2v_fast");
}

function googleVideoSize(model: string, requestedSize: string) {
    const value = modelOptionName(model).toLowerCase();
    if (value.includes("portrait")) return "720x1280";
    if (value.includes("landscape") || value === "omni") return "1280x720";
    return videoAspectRatioForSize(requestedSize) === "9:16" ? "720x1280" : "1280x720";
}
