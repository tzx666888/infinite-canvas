"use client";

import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Sparkles, Square } from "lucide-react";
import { App, Button, Dropdown } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { imageToDataUrl } from "@/services/image-storage";
import {
    analyzeProductBreakdown,
    analyzeSceneExpansion,
    buildProductCollagePrompt,
    buildSceneCollagePrompt,
    formatCommerceVideoPlan,
    formatProductBreakdownPlan,
    formatSceneExpansionPlan,
    polishPrompt,
    type PolishMode,
    type PolishReferenceImage,
    type PolishTemplate,
    type ProductBreakdownPlan,
    type SceneExpansionPlan,
} from "@/services/api/prompt-polish";
import { defaultConfig, modelMatchesCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { extractCommerceVideoPlan } from "../utils/video-prompt-compiler";
import { selectReferenceImageVideoModel } from "../utils/video-reference-model";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasCommerceVideoPlan, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

const POLISH_MENU_ITEMS = [
    { key: "optimize", label: "✨ 优化提示词" },
    { key: "product", label: "📦 产品拆解" },
    { key: "scene", label: "🖼️ 场景扩展" },
    { key: "storyboard", label: "🎬 视频分镜" },
    { key: "videoprompt", label: "🎥 视频提示词" },
] satisfies Array<{ key: PolishTemplate; label: string }>;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onGenerateProductBreakdown: (nodeId: string, plan: ProductBreakdownPlan) => Promise<void>;
    onGenerateSceneExpansion: (nodeId: string, plan: SceneExpansionPlan) => Promise<void>;
    onGenerateVideoStoryboard: (nodeId: string, plan: CanvasCommerceVideoPlan) => Promise<void>;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onGenerateProductBreakdown, onGenerateSceneExpansion, onGenerateVideoStoryboard, onStop, mentionReferences = [], onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const { message } = App.useApp();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type, globalConfig.videoModels.length > 0);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const [polishing, setPolishing] = useState(false);

    const [productBreakdownPlan, setProductBreakdownPlan] = useState<ProductBreakdownPlan | null>(null);
    const [sceneExpansionPlan, setSceneExpansionPlan] = useState<SceneExpansionPlan | null>(null);
    const [commerceVideoPlan, setCommerceVideoPlan] = useState<CanvasCommerceVideoPlan | null>(null);
    const savedCommerceVideoPlan = node.metadata?.commerceVideoPlan?.beats?.length ? node.metadata.commerceVideoPlan : null;
    const activeCommerceVideoPlan = commerceVideoPlan?.beats?.length ? commerceVideoPlan : savedCommerceVideoPlan;
    const credits = requestCreditCost({ channelMode: config.channelMode, model: config.model, count: mode === "image" ? config.count : 1 });
    const canPolish = mode === "image" || mode === "video";
    const canPolishInput = Boolean(prompt.trim() || getPolishTextContext(mentionReferences) || getPolishImageReferences(node, mentionReferences).length);

    useEffect(() => {
        setPrompt(savedCommerceVideoPlan ? formatCommerceVideoPlan(savedCommerceVideoPlan) : isEditingExistingContent ? "" : node.metadata?.prompt || "");
        setProductBreakdownPlan(null);
        setSceneExpansionPlan(null);
        setCommerceVideoPlan(savedCommerceVideoPlan);
    }, [isEditingExistingContent, node.id, savedCommerceVideoPlan]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        if (mode === "image" && productBreakdownPlan) {
            const count = Math.max(1, Math.min(productBreakdownPlan.shots.length, Math.floor(Number(config.count)) || 1));
            void onGenerateProductBreakdown(node.id, {
                ...productBreakdownPlan,
                shots: productBreakdownPlan.shots.slice(0, count),
            }).catch((error) => {
                message.error(`产品拆解图生成失败：${error instanceof Error ? error.message : "未知错误"}`);
            });
            return;
        }
        if (mode === "image" && sceneExpansionPlan) {
            const count = Math.max(1, Math.min(sceneExpansionPlan.scenes.length, Math.floor(Number(config.count)) || 1));
            void onGenerateSceneExpansion(node.id, {
                ...sceneExpansionPlan,
                scenes: sceneExpansionPlan.scenes.slice(0, count),
            }).catch((error) => {
                message.error(`场景图生成失败：${error instanceof Error ? error.message : "未知错误"}`);
            });
            return;
        }
        const storyboardPlan = activeCommerceVideoPlan || extractCommerceVideoPlan(text);
        if (mode !== "video" && storyboardPlan?.beats?.length) {
            setCommerceVideoPlan(storyboardPlan);
            onConfigChange(node.id, {
                commerceVideoPlan: storyboardPlan,
                selectedHookType: storyboardPlan.selectedHookType,
            } as Partial<CanvasNodeData["metadata"]>);
            void onGenerateVideoStoryboard(node.id, storyboardPlan).catch((error) => {
                message.error(`12宫格分镜候选生成失败：${error instanceof Error ? error.message : "未知错误"}`);
            });
            return;
        }
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    const handlePolish = async (template: PolishTemplate) => {
        if (!canPolish || polishing) return;
        const imageReferences = getPolishImageReferences(node, mentionReferences);
        const text = [prompt.trim(), getPolishTextContext(mentionReferences)].filter(Boolean).join("\n\n");
        if (!text && !imageReferences.length) {
            message.warning("请先输入提示词，或把产品图连接到当前节点");
            return;
        }
        setPolishing(true);
        try {
            const referenceImages = await loadPolishReferenceImages(imageReferences);
            if (!text && !referenceImages.length) throw new Error("没有读取到可用的参考图");
            if (template === "product") {
                setSceneExpansionPlan(null);
                const plan = await analyzeProductBreakdown(config, text, defaultConfig.textModel || "tokaxis::gpt-5.6-sol", referenceImages);
                setProductBreakdownPlan(null);
                updatePrompt(buildProductCollagePrompt(plan));
                message.success("产品拆解组合图 prompt 已回填，选择尺寸和数量后点击生成");
                return;
            }
            if (template === "scene") {
                if (mode !== "image") throw new Error("场景扩展请在图片节点上使用");
                setProductBreakdownPlan(null);
                const plan = await analyzeSceneExpansion(config, text, 10, defaultConfig.textModel || "tokaxis::gpt-5.6-sol", referenceImages);
                setSceneExpansionPlan(null);
                updatePrompt(buildSceneCollagePrompt(plan));
                message.success("场景扩展组合图 prompt 已回填，选择尺寸和数量后点击生成");
                return;
            }
            setProductBreakdownPlan(null);
            setSceneExpansionPlan(null);
            setCommerceVideoPlan(null);
            if (template === "storyboard") {
                const polishMode: PolishMode = "video";
                const result = await polishPrompt(config, text, polishMode, template, defaultConfig.textModel || "tokaxis::gpt-5.6-sol", referenceImages);
                const parsedPlan = extractCommerceVideoPlan(result);
                const plan = parsedPlan
                    ? {
                          ...parsedPlan,
                          directorBrief: text.trim() || parsedPlan.directorBrief,
                      }
                    : null;
                setCommerceVideoPlan(plan);
                if (plan) {
                    onConfigChange(node.id, {
                        commerceVideoPlan: plan,
                        selectedHookType: plan.selectedHookType,
                    } as Partial<CanvasNodeData["metadata"]>);
                }
                updatePrompt(result);
                message.success(plan ? "视频分镜规划已解析，点击生成按钮创建12宫格候选" : "已回填润色结果（JSON 解析失败，可手动修改后重试）");
                return;
            }
            const polishMode: PolishMode = mode === "video" || template === "videoprompt" ? "video" : "image";
            const result = await polishPrompt(config, text, polishMode, template, defaultConfig.textModel || "tokaxis::gpt-5.6-sol", referenceImages);
            const promptModel = mode === "video" && template === "videoprompt" ? selectReferenceImageVideoModel(config, referenceImages.length) : config.model;
            if (mode === "video" && template === "videoprompt" && promptModel && promptModel !== config.model) onConfigChange(node.id, { model: promptModel });
            const finalPrompt = mode === "video" && template === "videoprompt" ? selectVideoPromptForModel(result) : result;
            updatePrompt(finalPrompt);
            message.success(mode === "video" && template === "videoprompt" ? (promptModel !== config.model ? "已切换到参考图视频模型并回填提示词" : "已回填当前模型的视频提示词") : "已回填润色结果");
        } catch (error) {
            message.error(`润色失败：${error instanceof Error ? error.message : "未知错误"}`);
        } finally {
            setPolishing(false);
        }
    };

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasResourceMentionTextarea
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-[var(--canvas-prompt-textarea-height,6rem)] min-h-[72px] w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none transition focus:border-sky-300 focus:shadow-[0_0_0_2px_rgba(56,189,248,.35)] selection:bg-sky-400/35"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text, caretColor: "#38bdf8" }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {canPolish ? (
                        <>
                            <Dropdown
                                trigger={["click"]}
                                placement="topLeft"
                                disabled={!canPolishInput || polishing}
                                menu={{
                                    items: POLISH_MENU_ITEMS,
                                    onClick: ({ key }) => {
                                        void handlePolish(key as PolishTemplate);
                                    },
                                }}
                            >
                                <Button className="!h-10 !rounded-full !px-3" disabled={!canPolishInput || polishing} title="Agent 智能润色">
                                    <span className="flex items-center gap-1">
                                        {polishing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                        <span className="text-xs">Agent</span>
                                    </span>
                                </Button>
                            </Dropdown>

                        </>
                    ) : null}
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim() && !activeCommerceVideoPlan}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止</span>
                            </>
                        ) : (
                            <>
                                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                                    <CreditSymbol />
                                    {credits.toLocaleString()}
                                </span>
                                <ArrowUp className="size-4" />
                            </>
                        )}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function getPolishImageReferences(node: CanvasNodeData, references: CanvasResourceReference[]) {
    const seen = new Set<string>();
    const result: CanvasResourceReference[] = [];
    const pushReference = (reference: CanvasResourceReference) => {
        if (!reference.previewUrl || seen.has(reference.nodeId)) return;
        seen.add(reference.nodeId);
        result.push(reference);
    };
    references.filter((reference) => reference.active && reference.kind === "image").forEach(pushReference);
    if (node.type === CanvasNodeType.Image && node.metadata?.content) {
        pushReference({
            id: node.id,
            nodeId: node.id,
            kind: "image",
            label: "当前图片",
            title: node.title || "当前图片",
            previewUrl: node.metadata.content,
            active: true,
        });
    }
    return result.slice(0, 3);
}

function getPolishTextContext(references: CanvasResourceReference[]) {
    return references
        .filter((reference) => reference.active && reference.kind === "text" && reference.text?.trim())
        .map((reference) => `${reference.label}：${reference.text?.trim()}`)
        .join("\n\n");
}

async function loadPolishReferenceImages(references: CanvasResourceReference[]): Promise<PolishReferenceImage[]> {
    const images = await Promise.all(
        references.map(async (reference): Promise<PolishReferenceImage | null> => {
            try {
                const dataUrl = await imageToDataUrl({ url: reference.previewUrl });
                return dataUrl ? { dataUrl, label: reference.label, name: reference.title } : null;
            } catch {
                return null;
            }
        }),
    );
    return images.filter((image): image is PolishReferenceImage => Boolean(image?.dataUrl));
}

function selectVideoPromptForModel(raw: string) {
    const pattern = /##\s*Grok Version\s*\n([\s\S]*?)(?=\n##\s|$)/i;
    const match = raw.match(pattern);
    return match?.[1]?.trim() || raw;
}

function defaultMode(type: CanvasNodeData["type"], hasVideoModels: boolean): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video && hasVideoModels ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const configuredModel = node.metadata?.model;
    return {
        ...globalConfig,
        model: configuredModel && modelMatchesCapability(configuredModel, mode) ? configuredModel : defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model),
        videoModel: mode === "video" ? (configuredModel && modelMatchesCapability(configuredModel, mode) ? configuredModel : defaultModel || globalConfig.videoModel || defaultConfig.videoModel) : globalConfig.videoModel,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoProductScaleMode: node.metadata?.productScaleMode || globalConfig.videoProductScaleMode || defaultConfig.videoProductScaleMode,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoProductScaleMode") return { productScaleMode: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}


function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
