import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { defaultGoogleVideoEntrySettings, fixedGoogleVideoResolution, isGoogleVideoModel, normalizeGoogleVideoSeconds } from "@/lib/video-providers/google-video";
import { isSeedanceVideoModel, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceSupportsGeneratedAudio } from "@/lib/seedance-video";
import { videoAspectRatioForSize } from "@/lib/video-providers/shared";
import { isTokaxisMiniMaxH3VideoModel, normalizeMiniMaxH3Duration } from "@/lib/minimax-h3-video";
import { isTokaxisVideo30Model, normalizeVideo30Ratio } from "@/lib/video30";
import { facebookMediaPreset } from "@/lib/facebook-media";
import { productVideoSpec } from "@/lib/product-video-models";

export function resolveReferenceImageVideoConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    const model = selectReferenceImageVideoModel(config, referenceImageCount);
    const nextConfig = model && (model !== config.model || model !== config.videoModel) ? { ...config, model, videoModel: model } : config;
    const modelName = model || nextConfig.model;
    const deliverySize = facebookMediaPreset(nextConfig.size)?.id;
    const product = productVideoSpec(modelName);
    if (product?.family === "omni") {
        return {
            ...nextConfig,
            videoSeconds: "10",
            vquality: "1080",
            size: deliverySize || (videoAspectRatioForSize(nextConfig.size) === "9:16" ? "720x1280" : "1280x720"),
            videoGenerateAudio: String(nextConfig.videoGenerateAudio !== "false"),
        };
    }
    if (isTokaxisVideo30Model(modelName)) {
        return {
            ...nextConfig,
            videoSeconds: "30",
            vquality: "720",
            size: deliverySize || normalizeVideo30Ratio(nextConfig.size),
            videoGenerateAudio: "true",
        };
    }
    if (isTokaxisMiniMaxH3VideoModel(modelName)) {
        return {
            ...nextConfig,
            videoSeconds: String(normalizeMiniMaxH3Duration(nextConfig.videoSeconds)),
            vquality: "1440P",
            size: deliverySize || (videoAspectRatioForSize(nextConfig.size) === "9:16" ? "720x1280" : "1280x720"),
            videoGenerateAudio: String(nextConfig.videoGenerateAudio !== "false"),
        };
    }
    if (isSeedanceVideoModel(modelName)) {
        return {
            ...nextConfig,
            videoSeconds: String(normalizeSeedanceDuration(nextConfig.videoSeconds, modelName)),
            vquality: normalizeSeedanceResolution(nextConfig.vquality, modelName),
            size: deliverySize || normalizeSeedanceRatio(nextConfig.size, modelName),
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
    const product = productVideoSpec(model);
    if (product?.family === "omni") return { model, seconds: "10", vquality: "1080", generateAudio: "true" };
    const defaults = defaultGoogleVideoEntrySettings(model);
    if (defaults) return { model, seconds: defaults.videoSeconds, vquality: defaults.vquality };
    if (isTokaxisVideo30Model(model)) return { model, seconds: "30", vquality: "720", generateAudio: "true" };
    if (isTokaxisMiniMaxH3VideoModel(model)) return { model, seconds: "10", vquality: "1440P", generateAudio: "true" };
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

export function inferDirectVideoReferencePair(prompt: string, referenceCount: number) {
    const imageRef = String.raw`(?:@?\s*)?(?:图片|图像|图|image|img|photo|picture)\s*([1-9]\d*)`;
    const directedMatchers = [
        new RegExp(`${imageRef}\\s*(?:参考|参照|借鉴|依据|按照|根据|reference|references|refer(?:s)? to|based on|using)\\s*${imageRef}`, "i"),
        new RegExp(`${imageRef}\\s*(?:带|带着|拿|拿着|手持|展示|使用|融入|融合|加入|植入|结合|搭配|with|featuring|holding|using|showing|including|include|add(?:ing)?)\\s*${imageRef}(?:\\s*(?:产品|商品|物品|道具|object|product|item))?`, "i"),
    ];
    const match = directedMatchers.map((matcher) => prompt.match(matcher)).find(Boolean);
    if (!match) return null;
    const base = Number(match[1]);
    const reference = Number(match[2]);
    if (!Number.isFinite(base) || !Number.isFinite(reference)) return null;
    if (base < 1 || reference < 1 || base > referenceCount || reference > referenceCount || base === reference) return null;
    return { base, reference };
}

function googleVideoSize(model: string, requestedSize: string) {
    const deliverySize = facebookMediaPreset(requestedSize)?.id;
    if (deliverySize) return deliverySize;
    const value = modelOptionName(model).toLowerCase();
    if (value.includes("portrait")) return "720x1280";
    if (value.includes("landscape") || value === "omni") return "1280x720";
    return videoAspectRatioForSize(requestedSize) === "9:16" ? "720x1280" : "1280x720";
}
