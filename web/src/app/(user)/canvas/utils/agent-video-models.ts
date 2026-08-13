import { compactVideoModelPickerOptions, normalizeVideoModelPickerValue, resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { isGoogleVideoModel, supportsVideoReferenceCount, videoModelCapabilityContract, type VideoModelCapabilityContract } from "@/lib/video-model-settings";
import { modelMatchesCapability, modelOptionLabel, type AiConfig } from "@/stores/use-config-store";

export type AvailableAgentVideoModel = VideoModelCapabilityContract & {
    value: string;
    label: string;
};

export function availableAgentVideoModels(config: AiConfig, size: string, referenceImageCount = 1): AvailableAgentVideoModel[] {
    const eligible = config.videoModels.filter((model) => modelMatchesCapability(model, "video"));
    return compactVideoModelPickerOptions(eligible, size).flatMap((value) => {
        const capability = videoModelCapabilityContract(value);
        if (!capability || !supportsVideoReferenceCount(value, referenceImageCount) || !routeIsConfigured({ ...config, models: eligible, videoModels: eligible }, value, size, referenceImageCount)) return [];
        return [{ value, label: modelOptionLabel(config, value), ...capability }];
    });
}

export function selectedAgentVideoModel(options: AvailableAgentVideoModel[], current: string) {
    const values = options.map((item) => item.value);
    const normalized = normalizeVideoModelPickerValue(values, current);
    return values.includes(normalized) ? normalized : values[0] || "";
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
