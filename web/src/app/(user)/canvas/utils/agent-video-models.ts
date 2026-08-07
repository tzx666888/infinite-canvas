import { compactVideoModelPickerOptions, normalizeVideoModelPickerValue, resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { fixedVideoDurationOptions, fixedVideoResolution, googleVideoEntryMode, isGoogleVideoModel } from "@/lib/video-model-settings";
import { isSeedanceVideoModel, seedanceSupportsGeneratedAudio } from "@/lib/seedance-video";
import { modelMatchesCapability, modelOptionName, type AiConfig } from "@/stores/use-config-store";

import { AGENT_VIDEO_MODEL_OPTIONS, type AgentVideoModelOption } from "./agent-video-presets";

export type AvailableAgentVideoModel = {
    value: string;
    spec?: AgentVideoModelOption;
    durationSeconds: number;
    resolution: "720p" | "1080p";
    hasAudio: boolean;
    recommendation: string;
};

export function availableAgentVideoModels(config: AiConfig, size: string, referenceImageCount = 1): AvailableAgentVideoModel[] {
    const eligible = config.videoModels.filter((model) => modelMatchesCapability(model, "video"));
    return compactVideoModelPickerOptions(eligible, size)
        .filter((value) => routeIsConfigured({ ...config, models: eligible, videoModels: eligible }, value, size, referenceImageCount))
        .map((value, originalIndex) => {
            const spec = agentVideoModelSpec(value);
            const durationOptions = fixedVideoDurationOptions(value);
            const fixedResolution = fixedVideoResolution(value);
            return {
                value,
                spec,
                durationSeconds: spec?.durationSeconds || durationOptions?.at(-1) || 10,
                resolution: spec?.resolution || (fixedResolution === "1080" ? "1080p" : "720p"),
                hasAudio: spec?.hasAudio ?? (!isSeedanceVideoModel(value) || seedanceSupportsGeneratedAudio(value)),
                recommendation: spec?.recommendation || "",
                originalIndex,
            };
        })
        .sort((left, right) => modelEntryOrder(left.spec) - modelEntryOrder(right.spec) || left.originalIndex - right.originalIndex)
        .map(({ originalIndex: _originalIndex, ...item }) => item);
}

function routeIsConfigured(config: AiConfig, model: string, size: string, referenceImageCount: number) {
    if (!isGoogleVideoModel(model)) return true;
    try {
        resolveConfiguredGoogleVideoModel({ ...config, model, videoModel: model, size }, referenceImageCount);
        return true;
    } catch {
        return false;
    }
}

export function selectedAgentVideoModel(options: AvailableAgentVideoModel[], current: string) {
    const values = options.map((item) => item.value);
    const normalized = normalizeVideoModelPickerValue(values, current);
    if (values.includes(normalized)) return normalized;
    return options.find((item) => googleVideoEntryMode(item.value) === "omni")?.value || values[0] || "";
}

export function agentVideoFallbackModel(options: AvailableAgentVideoModel[], current: string) {
    const currentMode = googleVideoEntryMode(current);
    const fallbackMode = currentMode === "omni" ? "veo-auto" : "omni";
    return options.find((item) => googleVideoEntryMode(item.value) === fallbackMode)?.value;
}

export function agentVideoModelSpec(model: string): AgentVideoModelOption | undefined {
    const modelId = modelOptionName(model).toLowerCase();
    return AGENT_VIDEO_MODEL_OPTIONS.find((item) => (item.modelIds as readonly string[]).includes(modelId));
}

function modelEntryOrder(spec?: AgentVideoModelOption) {
    if (!spec) return AGENT_VIDEO_MODEL_OPTIONS.length;
    return AGENT_VIDEO_MODEL_OPTIONS.findIndex((item) => item.id === spec.id);
}
