import { resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { facebookMediaPreset } from "@/lib/facebook-media";
import {
    boolConfig,
    isSeedanceFixed720pModel,
    isSeedanceVideoConfig,
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceSupportsVideoAudioReferences,
    seedanceVideoReferenceError,
    SEEDANCE_REFERENCE_LIMITS,
} from "@/lib/seedance-video";
import { fixedVideoResolution, googleVideoRouteAspectRatio, isGoogleVideoModel, normalizeModelVideoSeconds } from "@/lib/video-model-settings";
import { isMiniMaxH3VideoConfig, MINIMAX_H3_REFERENCE_LIMITS, normalizeMiniMaxH3Duration, normalizeMiniMaxH3AspectRatio, tokaxisMiniMaxH3Resolution } from "@/lib/minimax-h3-video";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type VideoGenerationPreflightReferences = {
    images: ReferenceImage[];
    videos: ReferenceVideo[];
    audios: ReferenceAudio[];
};

export type VideoGenerationPreflightInput = {
    prompt: string;
    config: AiConfig;
    references: VideoGenerationPreflightReferences;
};

export type VideoGenerationPreflightResult = VideoGenerationPreflightInput & {
    errors: string[];
};

export type ConnectedVideoMediaSummary = {
    kind: keyof VideoGenerationPreflightReferences;
    label: string;
    count: number;
    names: string[];
};

export function prepareVideoGenerationPreflight(input: VideoGenerationPreflightInput): VideoGenerationPreflightResult {
    const prompt = input.prompt.trim();
    let config = { ...input.config };
    const errors = validateReferenceInputs(input.references);
    try {
        config = normalizeVideoGenerationPreflightConfig(config, input.references.images.length);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : "视频参数不兼容");
    }
    errors.push(...validateNormalizedVideoGenerationPreflight({ prompt, config, references: input.references }));
    return { prompt, config, references: input.references, errors: Array.from(new Set(errors.filter(Boolean))) };
}

export function normalizeVideoGenerationPreflightConfig(config: AiConfig, referenceImageCount: number): AiConfig {
    const selectedModel = (config.videoModel || config.model).trim();
    if (!selectedModel) return { ...config, model: "", videoModel: "" };
    const selectedConfig = { ...config, model: selectedModel, videoModel: selectedModel };
    const deliverySize = facebookMediaPreset(config.size)?.id;

    if (isGoogleVideoModel(selectedModel)) {
        const resolvedModel = resolveConfiguredGoogleVideoModel(selectedConfig, referenceImageCount);
        const modelName = modelOptionName(resolvedModel);
        const videoSeconds = normalizeModelVideoSeconds(config.videoSeconds, modelName);
        const ratio = googleVideoRouteAspectRatio(modelName, config.size);
        return {
            ...selectedConfig,
            model: resolvedModel,
            videoModel: resolvedModel,
            videoSeconds,
            size: deliverySize || (ratio === "9:16" ? "720x1280" : "1280x720"),
            vquality: fixedVideoResolution(modelName, videoSeconds) || config.vquality || "720",
        };
    }

    if (isMiniMaxH3VideoConfig(selectedConfig)) {
        const modelName = modelOptionName(selectedModel);
        const ratio = normalizeMiniMaxH3AspectRatio(config.size);
        return {
            ...selectedConfig,
            videoSeconds: String(normalizeMiniMaxH3Duration(config.videoSeconds)),
            size: deliverySize || (ratio === "9:16" ? "720x1280" : "1280x720"),
            vquality: tokaxisMiniMaxH3Resolution(modelName) === "2K" ? "2K" : "720",
            videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
            videoWatermark: String(boolConfig(config.videoWatermark, false)),
        };
    }

    if (isSeedanceVideoConfig(selectedConfig)) {
        const modelName = modelOptionName(selectedModel);
        return {
            ...selectedConfig,
            videoSeconds: String(normalizeSeedanceDuration(config.videoSeconds, modelName)),
            size: deliverySize || normalizeSeedanceRatio(config.size, modelName),
            vquality: normalizeSeedanceResolution(config.vquality, modelName),
            videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
            videoWatermark: String(boolConfig(config.videoWatermark, false)),
        };
    }

    return {
        ...selectedConfig,
        videoSeconds: normalizeModelVideoSeconds(config.videoSeconds, modelOptionName(selectedModel)),
    };
}

export function validateVideoGenerationPreflight(input: VideoGenerationPreflightInput): string[] {
    return prepareVideoGenerationPreflight(input).errors;
}

export function summarizeConnectedVideoMedia(references: VideoGenerationPreflightReferences): ConnectedVideoMediaSummary[] {
    return [
        { kind: "images", label: "图片", count: references.images.length, names: references.images.map((item, index) => item.name || `图片 ${index + 1}`) },
        { kind: "videos", label: "视频", count: references.videos.length, names: references.videos.map((item, index) => item.name || `视频 ${index + 1}`) },
        { kind: "audios", label: "音频", count: references.audios.length, names: references.audios.map((item, index) => item.name || `音频 ${index + 1}`) },
    ];
}

function validateNormalizedVideoGenerationPreflight(input: VideoGenerationPreflightInput) {
    const errors: string[] = [];
    const selectedModel = (input.config.videoModel || input.config.model).trim();
    const modelName = modelOptionName(selectedModel);
    const { images, videos, audios } = input.references;
    if (!selectedModel) return ["请选择视频模型"];

    if (isGoogleVideoModel(modelName)) {
        if (videos.length || audios.length) errors.push("Veo / Omni 不支持参考视频或参考音频；请移除这些素材，或切换到 Seedance 2.0");
        if (!input.prompt && !images.length) errors.push("请输入视频提示词，或至少连接 1 张参考图");
        return errors;
    }

    if (isMiniMaxH3VideoConfig(input.config)) {
        if (videos.length) errors.push("MiniMax H3 不支持参考视频，请移除参考视频后重试");
        if (images.length > MINIMAX_H3_REFERENCE_LIMITS.images) errors.push(`MiniMax H3 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.images} 张参考图`);
        if (audios.length > MINIMAX_H3_REFERENCE_LIMITS.audios) errors.push(`MiniMax H3 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.audios} 个参考音频`);
        if (audios.length && !images.length) errors.push("MiniMax H3 参考音频需要同时提供参考图");
        if (!input.prompt && !images.length) errors.push("请输入视频提示词，或至少连接 1 张参考图");
        return errors;
    }

    if (isSeedanceVideoConfig(input.config)) {
        if (images.length > SEEDANCE_REFERENCE_LIMITS.images) errors.push(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.images} 张参考图`);
        if (videos.length > SEEDANCE_REFERENCE_LIMITS.videos) errors.push(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.videos} 个参考视频`);
        if (audios.length > SEEDANCE_REFERENCE_LIMITS.audios) errors.push(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.audios} 个参考音频`);
        if (!seedanceSupportsVideoAudioReferences(modelName) && (videos.length || audios.length)) errors.push(`${modelName} 只支持文字和参考图，不支持参考视频或参考音频`);
        if (audios.length && !images.length && !videos.length) errors.push("Seedance 参考音频不能单独使用，请同时连接参考图或参考视频");
        const videoError = seedanceVideoReferenceError(videos);
        if (videoError) errors.push(videoError);
        const audioError = seedanceAudioReferenceError(audios);
        if (audioError) errors.push(audioError);
        if (!input.prompt && !images.length && !videos.length && !audios.length) errors.push("请输入视频提示词，或连接参考图片、视频或音频");
        if (!input.prompt && !isSeedanceFixed720pModel(modelName) && !images.length && !videos.length) errors.push("当前 Seedance 输入缺少有效的提示词、参考图或参考视频");
        return errors;
    }

    return ["当前模型暂不支持画布视频生成，请选择当前能力表中的视频模型"];
}

function validateReferenceInputs(references: VideoGenerationPreflightReferences) {
    const errors: string[] = [];
    references.images.forEach((item, index) => {
        if (!item.dataUrl && !item.url && !item.storageKey) errors.push(`参考图 ${index + 1} 内容无效，请重新连接`);
    });
    references.videos.forEach((item, index) => {
        if (!item.url && !item.storageKey) errors.push(`参考视频 ${index + 1} 内容无效，请重新连接`);
    });
    references.audios.forEach((item, index) => {
        if (!item.url && !item.storageKey) errors.push(`参考音频 ${index + 1} 内容无效，请重新连接`);
    });
    return errors;
}

function seedanceAudioReferenceError(audios: ReferenceAudio[]) {
    let totalDurationMs = 0;
    for (let index = 0; index < audios.length; index += 1) {
        const durationMs = audios[index].durationMs || 0;
        if (!durationMs) continue;
        if (durationMs < 2000 || durationMs > 15000) return `音频${index + 1} 时长需要在 2-15 秒之间`;
        totalDurationMs += durationMs;
    }
    return totalDurationMs > 15000 ? "Seedance 参考音频总时长不能超过 15 秒" : "";
}
