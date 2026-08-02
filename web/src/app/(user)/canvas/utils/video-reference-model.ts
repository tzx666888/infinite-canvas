import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { fixedGoogleVideoResolution, googleVideoReferenceImageLimit, isGoogleVideoModel, normalizeGoogleVideoSeconds } from "@/lib/video-providers/google-video";
import { videoAspectRatioForSize } from "@/lib/video-providers/shared";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    const model = selectReferenceImageVideoModel(config, referenceImageCount);
    const nextConfig = model && (model !== config.model || model !== config.videoModel) ? { ...config, model, videoModel: model } : config;
    const effectiveReferenceCount = Math.min(referenceImageCount, Math.max(0, googleVideoReferenceImageLimit(model || nextConfig.model)));
    if (!isGoogleVideoModel(model || nextConfig.model)) return nextConfig;
    return {
        ...nextConfig,
        videoSeconds: normalizeGoogleVideoSeconds(nextConfig.videoSeconds, model || nextConfig.model),
        vquality: fixedGoogleVideoResolution(model || nextConfig.model) || nextConfig.vquality,
        size: googleVideoSize(model || nextConfig.model, nextConfig.size),
    };
}

export function selectReferenceImageVideoModel(config: AiConfig, referenceImageCount: number) {
    const currentModel = config.videoModel || config.model;
    return isGoogleVideoModel(currentModel) ? resolveConfiguredGoogleVideoModel(config, referenceImageCount) : currentModel;
}

function googleVideoSize(model: string, requestedSize: string) {
    const value = modelOptionName(model).toLowerCase();
    if (value.includes("portrait")) return "720x1280";
    if (value.includes("landscape") || value === "omni") return "1280x720";
    return videoAspectRatioForSize(requestedSize) === "9:16" ? "720x1280" : "1280x720";
}
