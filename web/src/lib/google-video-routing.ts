import type { AiConfig } from "@/stores/use-config-store";

import { fixedVideoResolution, googleVideoEntryInfo, googleVideoEntryMode, googleVideoRouteAspectRatio, isGoogleVideoModel, normalizeReferenceVideoSeconds, resolveGoogleVideoRouteModelId, type GoogleVideoEntryMode } from "@/lib/video-model-settings";

const CHANNEL_MODEL_SEPARATOR = "::";
const ENTRY_ORDER: GoogleVideoEntryMode[] = ["veo-auto", "veo-r2v", "omni"];

export function resolveConfiguredGoogleVideoModel(config: AiConfig, referenceImageCount: number) {
    const selected = config.videoModel || config.model;
    if (!isGoogleVideoModel(selected)) return selected;
    const targetId = resolveGoogleVideoRouteModelId(selected, referenceImageCount, googleVideoRouteAspectRatio(selected, config.size));
    const resolved = findConfiguredModelOption(config, targetId, selected);
    if (resolved) return resolved;
    throw new Error(`当前令牌未开放路由所需的视频模型：${targetId}`);
}

export function compactVideoModelPickerOptions(models: string[], requestedSize: string) {
    const googleModels = models.filter(isGoogleVideoModel);
    const otherModels = models.filter((model) => !isGoogleVideoModel(model));
    const representatives = ENTRY_ORDER.map((mode) => representativeForMode(googleModels, mode, requestedSize)).filter((model): model is string => Boolean(model));
    return Array.from(new Set([...representatives, ...otherModels]));
}

export function normalizeVideoModelPickerValue(options: string[], current: string) {
    const mode = googleVideoEntryMode(current);
    if (!mode) return current;
    return options.find((option) => googleVideoEntryMode(option) === mode) || current;
}

export function expandVideoModelPickerSelection(selected: string[], available: string[]) {
    const selectedGoogleModes = new Set(selected.map(googleVideoEntryMode).filter((mode): mode is GoogleVideoEntryMode => Boolean(mode)));
    const selectedOtherModels = new Set(selected.filter((model) => !isGoogleVideoModel(model)));
    const expanded = available.filter((model) => {
        const mode = googleVideoEntryMode(model);
        return mode ? selectedGoogleModes.has(mode) : selectedOtherModels.has(model);
    });
    return Array.from(new Set([...expanded, ...selected.filter((model) => !isGoogleVideoModel(model) && !available.includes(model))]));
}

export function summarizeConfiguredGoogleVideoRoute(config: AiConfig, referenceImageCount: number) {
    const selected = config.videoModel || config.model;
    if (!isGoogleVideoModel(selected)) return null;
    try {
        const resolved = resolveConfiguredGoogleVideoModel(config, referenceImageCount);
        const modelId = rawModelName(resolved);
        const route = modelId.startsWith("veo_3_1_t2v") ? "Veo 文生" : modelId.startsWith("veo_3_1_i2v") ? (referenceImageCount >= 2 ? "Veo 首尾帧" : "Veo 首帧") : modelId.startsWith("veo_3_1_r2v") ? "Veo 多参考" : "Omni";
        const orientation = modelId.includes("portrait") ? "竖屏" : "横屏";
        const resolution = fixedVideoResolution(modelId) || config.vquality || "720";
        const seconds = normalizeReferenceVideoSeconds(config.videoSeconds, modelId, referenceImageCount);
        return { model: resolved, text: `${route} · ${orientation} · ${resolution}p · ${seconds}秒`, error: false } as const;
    } catch (error) {
        return { model: "", text: error instanceof Error ? error.message : "视频参数不兼容", error: true } as const;
    }
}

export function videoModelPickerEntryInfo(model: string) {
    return googleVideoEntryInfo(model);
}

function representativeForMode(models: string[], mode: GoogleVideoEntryMode, requestedSize: string) {
    const candidates = models.filter((model) => googleVideoEntryMode(model) === mode);
    if (!candidates.length) return "";
    const selected = candidates[0];
    const targetId = resolveGoogleVideoRouteModelId(selected, mode === "veo-auto" ? 1 : mode === "veo-r2v" ? 1 : 0, googleVideoRouteAspectRatio(selected, requestedSize));
    return findModelOption(candidates, targetId, selected) || candidates.find((model) => matchesRequestedOrientation(model, requestedSize)) || candidates[0];
}

function findConfiguredModelOption(config: AiConfig, targetId: string, selected: string) {
    return findModelOption(Array.from(new Set([...config.videoModels, ...config.models])), targetId, selected);
}

function findModelOption(options: string[], targetId: string, selected: string) {
    const channel = channelId(selected);
    return options.find((option) => rawModelName(option) === targetId && (!channel || channelId(option) === channel)) || options.find((option) => rawModelName(option) === targetId);
}

function matchesRequestedOrientation(model: string, requestedSize: string) {
    const id = rawModelName(model).toLowerCase();
    const aspectRatio = googleVideoRouteAspectRatio(model, requestedSize);
    return aspectRatio === "9:16" ? id.includes("portrait") : id.includes("landscape") || id === "omni" || id === "veo_3_1_r2v_fast";
}

function rawModelName(value: string) {
    return value.trim().split(CHANNEL_MODEL_SEPARATOR).at(-1) || "";
}

function channelId(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    return index < 0 ? "" : value.slice(0, index);
}
