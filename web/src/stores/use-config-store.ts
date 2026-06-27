"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { modelDisplayInfo } from "@/lib/model-display";

export type ApiCallFormat = "openai" | "gemini";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    tokaxisDefaultsVersion?: number;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    proxyMode: "direct" | "nextjs";
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
const CHANNEL_MODEL_SEPARATOR = "::";
const TOKAXIS_CHANNEL_ID = "default";
const TOKAXIS_BASE_URL = "/api/tokaxis";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const TOKAXIS_DEFAULTS_VERSION = 6;
const TOKAXIS_FALLBACK_MODELS = [
    "gpt-image-2",
    "grok-imagine-video",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-4o-mini-tts",
    "tts-1",
];
const TOKAXIS_DISABLED_IMAGE_MODEL_RE = /^nano-banana(?:-|$)/;
const TOKAXIS_DISABLED_VIDEO_MODEL_RE = /^veo_3_1_/;
const TOKAXIS_VIDEO_MODEL_IDS = new Set([
    "grok-imagine-video",
]);
const TOKAXIS_FALLBACK_MODEL_OPTIONS = TOKAXIS_FALLBACK_MODELS.map((model) => encodeChannelModel(TOKAXIS_CHANNEL_ID, model));
const TOKAXIS_IMAGE_MODELS = filterModelsByCapability(TOKAXIS_FALLBACK_MODEL_OPTIONS, "image");
const TOKAXIS_VIDEO_MODELS = filterModelsByCapability(TOKAXIS_FALLBACK_MODEL_OPTIONS, "video");
const TOKAXIS_TEXT_MODELS = filterModelsByCapability(TOKAXIS_FALLBACK_MODEL_OPTIONS, "text");
const TOKAXIS_AUDIO_MODELS = filterModelsByCapability(TOKAXIS_FALLBACK_MODEL_OPTIONS, "audio");

export const defaultConfig: AiConfig = {
    channelMode: "local",
    tokaxisDefaultsVersion: TOKAXIS_DEFAULTS_VERSION,
    baseUrl: TOKAXIS_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: TOKAXIS_CHANNEL_ID,
            name: "TokAxis",
            baseUrl: TOKAXIS_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: TOKAXIS_FALLBACK_MODELS,
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: TOKAXIS_FALLBACK_MODEL_OPTIONS,
    imageModels: TOKAXIS_IMAGE_MODELS,
    videoModels: TOKAXIS_VIDEO_MODELS,
    textModels: TOKAXIS_TEXT_MODELS,
    audioModels: TOKAXIS_AUDIO_MODELS,
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    proxyMode: "direct",
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    syncModelsFromKey: (apiKey: string) => Promise<number>;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    if (isDisabledModelName(value)) return false;
    return TOKAXIS_VIDEO_MODEL_IDS.has(value);
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return !isVideoModelName(model) && !isAudioModelName(model) && (value.includes("seedream") || value.includes("gpt-image") || value.includes("image") || value.includes("dall-e") || value.includes("dalle") || value.includes("imagen") || value.includes("flux") || value.includes("sdxl") || value.includes("stable-diffusion") || value.includes("midjourney"));
}

function isAudioModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    if (isDisabledModelName(model)) return false;
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (isDisabledModelName(model)) return false;
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (!requiresClientApiKey(channel.baseUrl) || channel.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            syncModelsFromKey: async (apiKey) => {
                const savedApiKey = apiKey.trim();
                const authApiKey = normalizeTokaxisApiKey(savedApiKey);
                let syncedModels = TOKAXIS_FALLBACK_MODELS;

                if (authApiKey) {
                    try {
                        const response = await fetch(buildApiUrl(TOKAXIS_BASE_URL, "/models"), {
                            headers: { Authorization: `Bearer ${authApiKey}` },
                        });
                        if (!response.ok) throw new Error(`TokAxis models sync failed: ${response.status}`);
                        const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
                        syncedModels = sanitizeTokaxisModels((payload.data || []).map((item) => (typeof item.id === "string" ? item.id : "")));
                    } catch (error) {
                        console.warn("[TokAxis] model sync failed, using fallback models", error);
                    }
                }

                set((state) => ({
                    config: buildTokaxisConfigWithModels(state.config, savedApiKey, syncedModels),
                }));
                return syncedModels.length;
            },
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeTokaxisChannels(config);
                const models = modelOptionsFromChannels(channels);
                const capabilityLists = modelListsFromModels(models);
                const imageModels = mergeTokaxisModelList(config.imageModels, capabilityLists.imageModels, channels);
                const videoModels = mergeTokaxisModelList(config.videoModels, capabilityLists.videoModels, channels);
                const textModels = mergeTokaxisModelList(config.textModels, capabilityLists.textModels, channels);
                const audioModels = mergeTokaxisModelList(config.audioModels, capabilityLists.audioModels, channels);
                const shouldMigrateTokaxisDefaults = (persistedConfig.tokaxisDefaultsVersion || 0) < TOKAXIS_DEFAULTS_VERSION;
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        tokaxisDefaultsVersion: TOKAXIS_DEFAULTS_VERSION,
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        baseUrl: TOKAXIS_BASE_URL,
                        model: normalizeDefaultTokaxisModel(config.model, models, channels) || models[0] || "",
                        imageModel: normalizeDefaultTokaxisImageModel(config.imageModel || config.model, shouldMigrateTokaxisDefaults, imageModels, channels),
                        videoModel: normalizeDefaultTokaxisModel(config.videoModel, videoModels, channels) || "",
                        textModel: normalizeDefaultTokaxisModel(config.textModel || config.model, textModels, channels),
                        audioModel: normalizeDefaultTokaxisModel(config.audioModel || defaultConfig.audioModel, audioModels, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                        imageModels,
                        videoModels,
                        textModels,
                        audioModels,
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[], channels: ModelChannel[]) {
    const allModelOptions = channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model)));
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)))
        .map((model) => normalizeModelOptionValue(model, channels))
        .filter((model) => !allModelOptions.length || allModelOptions.includes(model) || !isChannelModelValue(model));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: uniqueRawModels(channel?.models || []),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelDisplayName(value: string) {
    const model = modelOptionName(value);
    return modelDisplayInfo(model).label;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return modelDisplayName(value);
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const label = modelDisplayName(decoded.model);
    if (!channel || config.channels.length <= 1) return label;
    return `${label}（${channel.name}）`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.includes(decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.includes(model)) || channels[0];
    return channel && channel.models.includes(model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

export function isTokaxisProxyBaseUrl(baseUrl: string) {
    const value = baseUrl.trim().replace(/\/+$/, "");
    return value === TOKAXIS_BASE_URL;
}

export function requiresClientApiKey(baseUrl: string) {
    return Boolean(baseUrl.trim());
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: uniqueRawModels(channel.models || []),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: uniqueRawModels([
                    ...(config.models || []),
                    config.model,
                    config.imageModel,
                    config.videoModel,
                    config.textModel,
                    config.audioModel,
                ]),
            }),
        );
    }
    return channels.map((channel) => ({ ...channel, models: uniqueRawModels(channel.models) }));
}

function normalizeTokaxisChannels(config: AiConfig) {
    const first = Array.isArray(config.channels) ? config.channels[0] : undefined;
    const persistedModels = first?.models?.length ? first.models : [];
    const modelSource = persistedModels.length ? persistedModels : config.models?.map(modelOptionName) || [];
    const models = sanitizeTokaxisModels(modelSource.length ? modelSource : TOKAXIS_FALLBACK_MODELS);
    return [
        createModelChannel({
            id: TOKAXIS_CHANNEL_ID,
            name: "TokAxis",
            baseUrl: TOKAXIS_BASE_URL,
            apiKey: first?.apiKey || config.apiKey || "",
            apiFormat: "openai",
            models,
        }),
    ];
}

function normalizeDefaultTokaxisModel(value: string | undefined, options: string[], channels = normalizeTokaxisChannels(defaultConfig)) {
    const normalized = normalizeModelOptionValue(value, channels);
    return options.includes(normalized) ? normalized : options[0];
}

function normalizeDefaultTokaxisImageModel(value: string | undefined, shouldMigrateTokaxisDefaults: boolean, options = TOKAXIS_IMAGE_MODELS, channels = normalizeTokaxisChannels(defaultConfig)) {
    const normalized = normalizeDefaultTokaxisModel(value, options, channels);
    if (shouldMigrateTokaxisDefaults && modelOptionName(normalized) === "gpt-image-2") return defaultConfig.imageModel;
    return normalized;
}

function mergeTokaxisModelList(current: string[], defaults: string[], channels: ModelChannel[]) {
    const allowed = new Set(modelOptionsFromChannels(channels));
    const kept = normalizeModelList(current || [], channels).filter((model) => allowed.has(model) && defaults.includes(model));
    return Array.from(new Set([...kept, ...defaults]));
}

function buildTokaxisConfigWithModels(config: AiConfig, apiKey: string, rawModels: string[]): AiConfig {
    const models = sanitizeTokaxisModels(rawModels);
    const channel = createModelChannel({
        id: TOKAXIS_CHANNEL_ID,
        name: "TokAxis",
        baseUrl: TOKAXIS_BASE_URL,
        apiKey,
        apiFormat: "openai",
        models,
    });
    const channels = [channel];
    const modelOptions = modelOptionsFromChannels(channels);
    const capabilityLists = modelListsFromModels(modelOptions);
    return {
        ...config,
        channelMode: "local",
        tokaxisDefaultsVersion: TOKAXIS_DEFAULTS_VERSION,
        baseUrl: TOKAXIS_BASE_URL,
        apiKey,
        apiFormat: "openai",
        channels,
        models: modelOptions,
        imageModels: capabilityLists.imageModels,
        videoModels: capabilityLists.videoModels,
        textModels: capabilityLists.textModels,
        audioModels: capabilityLists.audioModels,
        model: normalizeDefaultTokaxisModel(config.model, modelOptions, channels) || modelOptions[0] || "",
        imageModel: normalizeDefaultTokaxisModel(config.imageModel || config.model, capabilityLists.imageModels, channels) || "",
        videoModel: normalizeDefaultTokaxisModel(config.videoModel, capabilityLists.videoModels, channels) || "",
        textModel: normalizeDefaultTokaxisModel(config.textModel || config.model, capabilityLists.textModels, channels) || "",
        audioModel: normalizeDefaultTokaxisModel(config.audioModel, capabilityLists.audioModels, channels) || "",
    };
}

function modelListsFromModels(models: string[]) {
    return {
        imageModels: filterModelsByCapability(models, "image"),
        videoModels: filterModelsByCapability(models, "video"),
        textModels: filterModelsByCapability(models, "text"),
        audioModels: filterModelsByCapability(models, "audio"),
    };
}

function sanitizeTokaxisModels(models: string[]) {
    const visibleModels = uniqueRawModels(models).filter(
        (model) => !isDisabledModelName(model) && !TOKAXIS_DISABLED_IMAGE_MODEL_RE.test(model) && (!isImageModelName(model) || model === "gpt-image-2"),
    );
    return visibleModels.length ? visibleModels : TOKAXIS_FALLBACK_MODELS;
}

function normalizeTokaxisApiKey(apiKey: string) {
    const value = apiKey.trim();
    if (!value) return "";
    return value.startsWith("sk-") ? value : `sk-${value}`;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : TOKAXIS_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map((model) => modelOptionName(model).trim()).filter((model) => Boolean(model) && !isDisabledModelName(model))));
}

function isDisabledModelName(model: string) {
    return TOKAXIS_DISABLED_VIDEO_MODEL_RE.test(modelOptionName(model).trim().toLowerCase());
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = normalizeTokaxisProxyBaseUrl(baseUrl).trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeTokaxisProxyBaseUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    try {
        const url = new URL(normalized);
        if (url.hostname.toLowerCase() === "ai.tokaxis.com" && (url.pathname === "" || url.pathname === "/" || url.pathname === "/v1")) return TOKAXIS_BASE_URL;
    } catch {
        // Relative URLs such as /api/tokaxis land here.
    }
    return normalized;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
