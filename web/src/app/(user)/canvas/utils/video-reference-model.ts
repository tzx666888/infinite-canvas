import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { defaultGoogleVideoEntrySettings, fixedGoogleVideoResolution, isGoogleVideoModel, normalizeGoogleVideoSeconds } from "@/lib/video-providers/google-video";
import { isSeedanceVideoModel, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceSupportsGeneratedAudio } from "@/lib/seedance-video";
import { videoAspectRatioForSize } from "@/lib/video-providers/shared";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    const model = selectReferenceImageVideoModel(config, referenceImageCount);
    const nextConfig = model && (model !== config.model || model !== config.videoModel) ? { ...config, model, videoModel: model } : config;
    const modelName = model || nextConfig.model;
    if (isSeedanceVideoModel(modelName)) {
        return {
            ...nextConfig,
            videoSeconds: String(normalizeSeedanceDuration(nextConfig.videoSeconds, modelName)),
            vquality: normalizeSeedanceResolution(nextConfig.vquality, modelName),
            size: normalizeSeedanceRatio(nextConfig.size, modelName),
            videoGenerateAudio: String(seedanceSupportsGeneratedAudio(modelName) && nextConfig.videoGenerateAudio !== "false"),
        };
    }
    if (!isGoogleVideoModel(modelName)) return nextConfig;
    const videoSeconds = normalizeGoogleVideoSeconds(nextConfig.videoSeconds, modelName);
    return {
        ...nextConfig,
        videoSeconds,
        vquality: fixedGoogleVideoResolution(modelName, videoSeconds) || nextConfig.vquality,
        size: googleVideoSize(modelName, nextConfig.size),
    };
}

export function selectReferenceImageVideoModel(config: AiConfig, referenceImageCount: number) {
    const currentModel = config.videoModel || config.model;
    return isGoogleVideoModel(currentModel) ? resolveConfiguredGoogleVideoModel(config, referenceImageCount) : currentModel;
}

export function canvasVideoModelSelectionPatch(model: string) {
    const defaults = defaultGoogleVideoEntrySettings(model);
    if (defaults) return { model, seconds: defaults.videoSeconds, vquality: defaults.vquality };
    if (isSeedanceVideoModel(model)) {
        return {
            model,
            seconds: String(normalizeSeedanceDuration("8", model)),
            vquality: normalizeSeedanceResolution("720p", model),
            generateAudio: String(seedanceSupportsGeneratedAudio(model)),
        };
    }
    return { model };
}

function googleVideoSize(model: string, requestedSize: string) {
    const value = modelOptionName(model).toLowerCase();
    if (value.includes("portrait")) return "720x1280";
    if (value.includes("landscape") || value === "omni") return "1280x720";
    return videoAspectRatioForSize(requestedSize) === "9:16" ? "720x1280" : "1280x720";
}
