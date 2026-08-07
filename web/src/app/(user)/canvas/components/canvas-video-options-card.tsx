"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Select, Switch } from "antd";
import { Eye, ImagePlus, LoaderCircle, LockKeyhole, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { modelOptionLabel, useEffectiveConfig } from "@/stores/use-config-store";
import { sizeOptions } from "@/components/video-settings-panel";
import {
    AGENT_VIDEO_DEFAULT_MODEL_ID,
    AGENT_VIDEO_MARKETS,
    AGENT_VIDEO_PRESETS,
    type AgentVideoMarket,
    type AgentVideoPresetId,
} from "../utils/agent-video-presets";
import { availableAgentVideoModels, selectedAgentVideoModel } from "../utils/agent-video-models";
import { splitAgentVideoPrompt, validateAgentVideoPrompt, type AgentVideoPromptPart, type AgentVideoPromptWarning } from "../utils/agent-video-sop";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export type AgentVideoGenerationStage = "reading" | "compiling" | "generating";

export type AgentVideoReferenceRoles = {
    productNodeId: string;
    creatorNodeId?: string;
};

export type GenerateAgentVideoOptions = {
    references: AgentVideoReferenceRoles;
    presetId: AgentVideoPresetId;
    market: AgentVideoMarket;
    model: string;
    size: string;
    userIntent: string;
    creatorFile?: File;
    withSubtitle?: boolean;
    compileOnly?: boolean;
    promptOverride?: string;
    originalCompiledPrompt?: string;
    onStage?: (stage: AgentVideoGenerationStage) => void;
};

export type GenerateAgentVideoResult = {
    ok: boolean;
    videoNodeId?: string;
    creatorNodeId?: string;
    error?: string;
    errorKind?: string;
    retryModelId?: string;
    prompt?: string;
    warnings?: AgentVideoPromptWarning[];
};

type CanvasVideoOptionsCardProps = {
    detail: unknown;
    nodes: CanvasNodeData[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onGenerateVideoFromReference: (options: GenerateAgentVideoOptions) => Promise<GenerateAgentVideoResult>;
};

const VIDEO_SIZE_OPTIONS = sizeOptions.filter((item) => item.value === "720x1280" || item.value === "1280x720");
const DEFAULT_VIDEO_SIZE = "720x1280";

export function CanvasVideoOptionsCard({ detail, nodes, theme, onGenerateVideoFromReference }: CanvasVideoOptionsCardProps) {
    const config = useEffectiveConfig();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const detailRecord = objectRecord(detail);
    const userIntent = typeof detailRecord.userIntent === "string" ? detailRecord.userIntent : "基于参考产品生成真实视频";
    const requestedRoles = videoReferenceRoles(detailRecord.references);
    const legacyProductNodeId = Array.isArray(detailRecord.imageNodeIds) ? detailRecord.imageNodeIds.find((id): id is string => typeof id === "string") || "" : "";
    const [presetId, setPresetId] = useState<AgentVideoPresetId>(requestedRoles.creatorNodeId ? "creator" : "handsfree");
    const [market, setMarket] = useState<AgentVideoMarket>("ph");
    const [model, setModel] = useState<string>(AGENT_VIDEO_DEFAULT_MODEL_ID);
    const [size, setSize] = useState(DEFAULT_VIDEO_SIZE);
    const [withSubtitle, setWithSubtitle] = useState(false);
    const [productNodeId, setProductNodeId] = useState(requestedRoles.productNodeId || legacyProductNodeId);
    const [creatorNodeId, setCreatorNodeId] = useState(requestedRoles.creatorNodeId || "");
    const [creatorFile, setCreatorFile] = useState<File>();
    const [creatorPreviewUrl, setCreatorPreviewUrl] = useState("");
    const [running, setRunning] = useState(false);
    const [stage, setStage] = useState<AgentVideoGenerationStage>();
    const [feedback, setFeedback] = useState<{ kind: "success" | "error" | "info"; text: string; retryModelId?: string }>();
    const [promptPreview, setPromptPreview] = useState<{ original: string; parts: AgentVideoPromptPart[]; cacheKey: string }>();

    const preset = AGENT_VIDEO_PRESETS[presetId];
    const availableModels = useMemo(() => availableAgentVideoModels(config, size, preset.referenceImages), [config, preset.referenceImages, size]);
    const selectedModel = selectedAgentVideoModel(availableModels, model);
    const selectedModelSpec = availableModels.find((item) => item.value === selectedModel);
    const imageCandidates = nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.content);
    const productCandidates = imageCandidates.filter((node) => node.id !== creatorNodeId);
    const creatorCandidates = imageCandidates.filter((node) => node.id !== productNodeId);
    const productNode = productCandidates.find((node) => node.id === productNodeId) || imageCandidates.find((node) => node.id === productNodeId);
    const creatorNode = creatorCandidates.find((node) => node.id === creatorNodeId);
    const marketConfig = AGENT_VIDEO_MARKETS[market];
    const creatorReady = presetId !== "creator" || Boolean((creatorNode && creatorNode.id !== productNode?.id) || creatorFile);
    const canGenerate = Boolean(productNode && selectedModel && marketConfig.enabled && creatorReady && !running);
    const retryModel = feedback?.retryModelId ? availableModels.find((item) => item.value === feedback.retryModelId) : undefined;
    const promptCacheKey = JSON.stringify({ presetId, market, model: selectedModel, size, withSubtitle, userIntent, productNodeId: productNode?.id, creatorNodeId: creatorNode?.id, creatorFile: creatorFile ? [creatorFile.name, creatorFile.size, creatorFile.lastModified] : undefined });
    const editedPrompt = promptPreview?.parts.map((part) => part.text).join("").trim() || "";
    const editValidation = useMemo(
        () =>
            promptPreview && selectedModelSpec
                ? validateAgentVideoPrompt(editedPrompt, {
                      preset,
                      market,
                      durationSeconds: selectedModelSpec.durationSeconds,
                      withSubtitle,
                  })
                : undefined,
        [editedPrompt, market, preset, promptPreview, selectedModelSpec, withSubtitle],
    );
    const validationMessages = editValidation ? [...editValidation.errors, ...editValidation.warnings.map(promptWarningText)] : [];

    useEffect(() => {
        if (!creatorFile) {
            setCreatorPreviewUrl("");
            return;
        }
        const url = URL.createObjectURL(creatorFile);
        setCreatorPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [creatorFile]);

    useEffect(() => {
        if (!promptPreview || promptPreview.cacheKey === promptCacheKey) return;
        setPromptPreview(undefined);
        setFeedback({ kind: "info", text: "参数已变更，请重新生成提示词" });
    }, [promptCacheKey, promptPreview]);

    const invalidatePromptPreview = () => {
        setFeedback(promptPreview ? { kind: "info", text: "参数已变更，请重新生成提示词" } : undefined);
        setPromptPreview(undefined);
    };

    const generate = async (targetModel = selectedModel, compileOnly = false, forceCompile = false) => {
        if (!productNode || !targetModel || !creatorReady || running) return;
        setRunning(true);
        setFeedback(undefined);
        setStage("reading");
        try {
            const result = await onGenerateVideoFromReference({
                references: { productNodeId: productNode.id, ...(presetId === "creator" && creatorNode ? { creatorNodeId: creatorNode.id } : {}) },
                presetId,
                market,
                model: targetModel,
                size,
                userIntent,
                creatorFile: presetId === "creator" && !creatorNode ? creatorFile : undefined,
                withSubtitle,
                compileOnly,
                promptOverride: !compileOnly && promptPreview && !forceCompile ? editedPrompt : undefined,
                originalCompiledPrompt: !compileOnly && promptPreview && !forceCompile ? promptPreview.original : undefined,
                onStage: setStage,
            });
            if (result.creatorNodeId) {
                setCreatorNodeId(result.creatorNodeId);
                setCreatorFile(undefined);
            }
            if (compileOnly && result.ok && result.prompt) {
                setPromptPreview({ original: result.prompt, parts: splitAgentVideoPrompt(result.prompt, withSubtitle), cacheKey: promptCacheKey });
                setFeedback({ kind: "success", text: "提示词已生成，可编辑镜头、动作、转场、音效和口播。" });
            } else {
                setFeedback(result.ok ? { kind: "success", text: "视频已生成并保留在画布节点中。" } : { kind: "error", text: result.error || "视频生成失败，请重试。", retryModelId: result.retryModelId });
            }
        } catch {
            setFeedback({ kind: "error", text: "视频生成失败，请检查模型配置后重试。" });
        } finally {
            setRunning(false);
            setStage(undefined);
        }
    };

    const stageText = stage === "reading" ? "正在读取参考图…" : stage === "compiling" ? "正在编排镜头…" : stage === "generating" ? "正在生成视频…" : promptPreview ? "用这段生成" : "生成视频";

    return (
        <div className="min-w-0 flex-1 rounded-xl border p-4" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <Video className="size-4" />
                </span>
                <div className="min-w-0">
                    <div className="text-sm font-semibold">视频创作</div>
                    <div className="text-xs" style={{ color: theme.node.muted }}>选择参考产品、人物与生成参数</div>
                </div>
            </div>

            <CardField label="参考产品（必填）" theme={theme}>
                <CanvasImageReferencePicker
                    value={productNodeId}
                    nodes={productCandidates}
                    selectedNode={productNode}
                    theme={theme}
                    disabled={running}
                    placeholder="从画布选择产品图"
                    emptyText="请选择画布中的产品图"
                    onChange={(value) => {
                        setProductNodeId(value || "");
                        if (value && value === creatorNodeId) setCreatorNodeId("");
                        invalidatePromptPreview();
                    }}
                />
            </CardField>

            <div className="grid grid-cols-2 gap-3">
                <CardField label="剧情" theme={theme}>
                    <Select
                        className="w-full"
                        value={presetId}
                        disabled={running}
                        onChange={(value) => {
                            setPresetId(value);
                            invalidatePromptPreview();
                        }}
                        options={Object.values(AGENT_VIDEO_PRESETS).map((item) => ({ value: item.id, label: item.label }))}
                    />
                </CardField>
                <CardField label="市场" theme={theme}>
                    <Select
                        className="w-full"
                        value={market}
                        disabled={running}
                        onChange={(value) => {
                            setMarket(value);
                            invalidatePromptPreview();
                        }}
                        options={Object.values(AGENT_VIDEO_MARKETS).map((item) => ({ value: item.id, label: item.enabled ? item.label : `${item.label}（待开放）`, disabled: !item.enabled }))}
                    />
                    <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        创作语境：{marketConfig.platform} · {marketConfig.language}
                    </div>
                </CardField>
            </div>

            <CardField label="模型" theme={theme}>
                <Select
                    className="w-full"
                    value={selectedModel || undefined}
                    disabled={running}
                    placeholder="当前令牌暂无可用视频模型"
                    onChange={(value) => {
                        setModel(value);
                        invalidatePromptPreview();
                    }}
                    options={availableModels.map(({ value, spec, durationSeconds, resolution, hasAudio, recommendation }) => ({
                        value,
                        label: (
                            <span className="flex min-w-0 items-center justify-between gap-2">
                                <span className="min-w-0 truncate">{spec?.label || modelOptionLabel(config, value)}</span>
                                <span className="shrink-0 text-xs opacity-60">{durationSeconds} 秒 · {resolution} · {hasAudio ? "有声" : "无声"}{recommendation ? ` · ${recommendation}` : ""}</span>
                            </span>
                        ),
                    }))}
                />
                {selectedModelSpec && selectedModelSpec.durationSeconds < 15 ? (
                    <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        当前模型固定 {selectedModelSpec.durationSeconds} 秒，已自动精简为 3–4 镜；要完整五镜分镜请选择可用的 15 秒模型。
                    </div>
                ) : selectedModelSpec && !selectedModelSpec.hasAudio ? (
                    <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>该模型固定输出无声视频。</div>
                ) : null}
            </CardField>

            <CardField label="尺寸" theme={theme}>
                <Select
                    className="w-full"
                    value={size}
                    disabled={running}
                    onChange={(value) => {
                        setSize(value);
                        invalidatePromptPreview();
                    }}
                    options={VIDEO_SIZE_OPTIONS.map((item) => ({ value: item.value, label: `${item.label} · ${item.value}` }))}
                />
            </CardField>

            <CardField label="画面内字幕" theme={theme}>
                <div className="flex items-center gap-2">
                    <Switch
                        size="small"
                        checked={withSubtitle}
                        disabled={running}
                        onChange={(checked) => {
                            setWithSubtitle(checked);
                            invalidatePromptPreview();
                        }}
                    />
                    <span className="text-xs" style={{ color: theme.node.muted }}>{withSubtitle ? "开启" : "关闭"}</span>
                </div>
                <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>非中文市场的画面字幕可能出现错别字，建议先小批量验证</div>
            </CardField>

            {presetId === "creator" ? (
                <CardField label="参考人物（达人模式，必填）" theme={theme}>
                    <div className="space-y-2">
                        <CanvasImageReferencePicker
                            value={creatorNodeId}
                            nodes={creatorCandidates}
                            selectedNode={creatorNode}
                            previewUrl={creatorPreviewUrl}
                            theme={theme}
                            disabled={running}
                            placeholder="从画布选择人物图"
                            emptyText="请选择画布中的人物图，或上传人物图"
                            onChange={(value) => {
                                setCreatorNodeId(value || "");
                                if (value) setCreatorFile(undefined);
                                invalidatePromptPreview();
                            }}
                        />
                        <input
                            ref={fileInputRef}
                            hidden
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                    setCreatorFile(file);
                                    setCreatorNodeId("");
                                    invalidatePromptPreview();
                                }
                                event.target.value = "";
                            }}
                        />
                        <Button size="small" disabled={running} icon={<ImagePlus className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>上传人物图</Button>
                    </div>
                    {!creatorReady ? <div className="mt-1 text-xs text-red-600">请选择或上传人物参考图</div> : null}
                </CardField>
            ) : null}

            {promptPreview ? (
                <CardField label="视频提示词" theme={theme}>
                    <div className="space-y-2">
                        {validationMessages.length ? (
                            <div className="rounded-lg border border-red-500/35 px-3 py-2 text-xs leading-5 text-red-600">
                                {validationMessages.map((text) => <div key={text}>{text}</div>)}
                                <div>提示仅供检查，不会阻止生成。</div>
                            </div>
                        ) : null}
                        {promptPreview.parts.map((part, index) =>
                            part.kind === "locked" ? (
                                <div key={`${part.kind}-${index}`} className="rounded-lg border px-3 py-2" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                        <LockKeyhole className="size-3" />
                                        {part.label} · 已锁定
                                    </div>
                                    <div className="whitespace-pre-wrap text-xs leading-5">{part.text}</div>
                                </div>
                            ) : (
                                <textarea
                                    key={`${part.kind}-${index}`}
                                    data-canvas-no-zoom
                                    value={part.text}
                                    disabled={running}
                                    rows={promptEditorRows(part.text)}
                                    className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-xs leading-5 outline-none transition focus:ring-1"
                                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                    aria-label="可编辑视频提示词"
                                    onChange={(event) => {
                                        const text = event.target.value;
                                        setPromptPreview((current) =>
                                            current
                                                ? {
                                                      ...current,
                                                      parts: current.parts.map((item, partIndex) => (partIndex === index ? { ...item, text } : item)),
                                                  }
                                                : current,
                                        );
                                    }}
                                />
                            ),
                        )}
                    </div>
                </CardField>
            ) : null}

            {feedback ? (
                <div className="mt-3 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: feedback.kind === "error" ? "rgba(220,38,38,.35)" : theme.node.stroke, color: feedback.kind === "error" ? "#dc2626" : theme.node.muted }}>
                    {feedback.text}
                </div>
            ) : null}

            <div className="mt-4 flex gap-2">
                <Button type="primary" className="min-w-0 flex-1" disabled={!canGenerate} icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4" />} onClick={() => void generate()}>
                    {stageText}
                </Button>
                <Button className="min-w-0 flex-1" disabled={!canGenerate} icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Eye className="size-4" />} onClick={() => void generate(selectedModel, true)}>
                    {promptPreview ? "重新生成提示词" : "先看提示词"}
                </Button>
                {feedback?.kind === "error" && retryModel ? (
                    <Button
                        disabled={running}
                        onClick={() => {
                            setModel(retryModel.value);
                            if (promptPreview) invalidatePromptPreview();
                            else void generate(retryModel.value, false, true);
                        }}
                    >
                        {retryModel.spec?.id === "omni" ? "换 Omni 重试" : "换 Veo 重试"}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function CanvasImageReferencePicker({
    value,
    nodes,
    selectedNode,
    previewUrl,
    theme,
    disabled,
    placeholder,
    emptyText,
    onChange,
}: {
    value: string;
    nodes: CanvasNodeData[];
    selectedNode?: CanvasNodeData;
    previewUrl?: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    disabled: boolean;
    placeholder: string;
    emptyText: string;
    onChange: (value: string | undefined) => void;
}) {
    const preview = selectedNode?.metadata?.content || previewUrl;
    return (
        <div className="flex items-center gap-2">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                {preview ? <img src={preview} alt={selectedNode?.title || "参考图"} className="size-full object-cover" /> : <ImagePlus className="size-4" style={{ color: theme.node.muted }} />}
            </div>
            <div className="min-w-0 flex-1">
                <Select
                    className="w-full"
                    allowClear
                    value={value || undefined}
                    disabled={disabled}
                    placeholder={placeholder}
                    onChange={onChange}
                    options={nodes.map((node) => ({
                        value: node.id,
                        label: (
                            <span className="flex min-w-0 items-center gap-2">
                                <img src={node.metadata?.content} alt="" className="size-6 shrink-0 rounded object-cover" />
                                <span className="truncate">{node.title || node.id}</span>
                            </span>
                        ),
                    }))}
                />
                {!selectedNode && !previewUrl ? <div className="mt-1 text-[11px]" style={{ color: theme.node.muted }}>{emptyText}</div> : null}
            </div>
        </div>
    );
}

function CardField({ label, theme, children }: { label: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; children: ReactNode }) {
    return (
        <div className="mt-3">
            <div className="mb-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>{label}</div>
            {children}
        </div>
    );
}

function objectRecord(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function videoReferenceRoles(value: unknown) {
    const record = objectRecord(value);
    return {
        productNodeId: typeof record.productNodeId === "string" ? record.productNodeId : "",
        creatorNodeId: typeof record.creatorNodeId === "string" ? record.creatorNodeId : "",
    };
}

function promptEditorRows(value: string) {
    return Math.max(2, Math.min(12, value.split(/\r?\n/u).length + 1));
}

function promptWarningText(warning: AgentVideoPromptWarning) {
    const target = warning.targetMin ? `${warning.targetMin}–${warning.targetMax}` : `不超过 ${warning.targetMax}`;
    return `提示词当前 ${warning.actualLength} 字符，建议 ${target} 字符。`;
}
