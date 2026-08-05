"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Select } from "antd";
import { ImagePlus, LoaderCircle, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { modelOptionLabel, modelOptionName, useEffectiveConfig } from "@/stores/use-config-store";
import { sizeOptions } from "@/components/video-settings-panel";
import {
    AGENT_VIDEO_DEFAULT_MODEL_ID,
    AGENT_VIDEO_MARKETS,
    AGENT_VIDEO_MODEL_OPTIONS,
    AGENT_VIDEO_PRESETS,
    type AgentVideoMarket,
    type AgentVideoPresetId,
} from "../utils/agent-video-presets";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export type AgentVideoGenerationStage = "reading" | "compiling" | "generating";

export type GenerateAgentVideoOptions = {
    presetId: AgentVideoPresetId;
    market: AgentVideoMarket;
    model: string;
    size: string;
    userIntent: string;
    creatorNodeId?: string;
    creatorFile?: File;
    onStage?: (stage: AgentVideoGenerationStage) => void;
};

export type GenerateAgentVideoResult = {
    ok: boolean;
    videoNodeId?: string;
    creatorNodeId?: string;
    error?: string;
    errorKind?: string;
    retryModelId?: string;
};

type CanvasVideoOptionsCardProps = {
    detail: unknown;
    nodes: CanvasNodeData[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onGenerateVideoFromReference: (imageNodeIds: string[], options: GenerateAgentVideoOptions) => Promise<GenerateAgentVideoResult>;
};

const VIDEO_SIZE_OPTIONS = sizeOptions.filter((item) => item.value === "720x1280" || item.value === "1280x720");
const DEFAULT_VIDEO_SIZE = "720x1280";

export function CanvasVideoOptionsCard({ detail, nodes, theme, onGenerateVideoFromReference }: CanvasVideoOptionsCardProps) {
    const config = useEffectiveConfig();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const detailRecord = objectRecord(detail);
    const requestedIds = Array.isArray(detailRecord.imageNodeIds) ? detailRecord.imageNodeIds.filter((id): id is string => typeof id === "string") : [];
    const productNodes = requestedIds.map((id) => nodes.find((node) => node.id === id && node.type === CanvasNodeType.Image && node.metadata?.content)).filter((node): node is CanvasNodeData => Boolean(node));
    const productNode = productNodes.length === 1 ? productNodes[0] : undefined;
    const [presetId, setPresetId] = useState<AgentVideoPresetId>("handsfree");
    const [market, setMarket] = useState<AgentVideoMarket>("ph");
    const [model, setModel] = useState<string>(AGENT_VIDEO_DEFAULT_MODEL_ID);
    const [size, setSize] = useState(DEFAULT_VIDEO_SIZE);
    const [creatorNodeId, setCreatorNodeId] = useState("");
    const [creatorFile, setCreatorFile] = useState<File>();
    const [creatorPreviewUrl, setCreatorPreviewUrl] = useState("");
    const [running, setRunning] = useState(false);
    const [stage, setStage] = useState<AgentVideoGenerationStage>();
    const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string; retryModelId?: string }>();

    const availableModels = useMemo(
        () =>
            AGENT_VIDEO_MODEL_OPTIONS.flatMap((spec) =>
                config.videoModels.filter((candidate) => modelOptionName(candidate).toLowerCase() === spec.id.toLowerCase()).map((value) => ({ value, spec })),
            ),
        [config.videoModels],
    );
    const selectedModel = availableModels.some((item) => item.value === model)
        ? model
        : availableModels.find((item) => item.spec.id === AGENT_VIDEO_DEFAULT_MODEL_ID)?.value || availableModels[0]?.value || "";
    const selectedModelSpec = availableModels.find((item) => item.value === selectedModel)?.spec;
    const creatorCandidates = nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.content && !requestedIds.includes(node.id));
    const creatorNode = creatorCandidates.find((node) => node.id === creatorNodeId);
    const preset = AGENT_VIDEO_PRESETS[presetId];
    const creatorReady = presetId !== "creator" || Boolean(creatorNode || creatorFile);
    const canGenerate = Boolean(productNode && selectedModel && AGENT_VIDEO_MARKETS[market].enabled && creatorReady && !running);
    const retryModel = feedback?.retryModelId ? availableModels.find((item) => item.spec.id === feedback.retryModelId) : undefined;

    useEffect(() => {
        if (!creatorFile) {
            setCreatorPreviewUrl("");
            return;
        }
        const url = URL.createObjectURL(creatorFile);
        setCreatorPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [creatorFile]);

    const generate = async (targetModel = selectedModel) => {
        if (!productNode || !targetModel || !creatorReady || running) return;
        setRunning(true);
        setFeedback(undefined);
        setStage("reading");
        try {
            const result = await onGenerateVideoFromReference([productNode.id], {
                presetId,
                market,
                model: targetModel,
                size,
                userIntent: typeof detailRecord.userIntent === "string" ? detailRecord.userIntent : "用所选图片生成带货视频",
                creatorNodeId: presetId === "creator" ? creatorNode?.id : undefined,
                creatorFile: presetId === "creator" && !creatorNode ? creatorFile : undefined,
                onStage: setStage,
            });
            if (result.creatorNodeId) {
                setCreatorNodeId(result.creatorNodeId);
                setCreatorFile(undefined);
            }
            setFeedback(result.ok ? { kind: "success", text: "视频已生成并保留在画布节点中。" } : { kind: "error", text: result.error || "视频生成失败，请重试。", retryModelId: result.retryModelId });
        } catch {
            setFeedback({ kind: "error", text: "视频生成失败，请检查模型配置后重试。" });
        } finally {
            setRunning(false);
            setStage(undefined);
        }
    };

    const stageText = stage === "reading" ? "正在读取参考图…" : stage === "compiling" ? "正在编排镜头…" : stage === "generating" ? "正在生成视频…" : "生成视频";

    return (
        <div className="min-w-0 flex-1 rounded-xl border p-4" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <Video className="size-4" />
                </span>
                <div className="min-w-0">
                    <div className="text-sm font-semibold">带货视频</div>
                    <div className="text-xs" style={{ color: theme.node.muted }}>确认参考图与生成参数</div>
                </div>
            </div>

            <CardField label="参考图" theme={theme}>
                <div className="flex gap-2 overflow-x-auto">
                    {productNodes.map((node) => (
                        <div key={node.id} className="size-16 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }} title={node.title}>
                            <img src={node.metadata?.content} alt={node.title || "产品参考图"} className="size-full object-cover" />
                        </div>
                    ))}
                    {!productNodes.length ? <span className="text-xs" style={{ color: theme.node.muted }}>参考图已丢失</span> : null}
                </div>
            </CardField>

            <div className="grid grid-cols-2 gap-3">
                <CardField label="剧情" theme={theme}>
                    <Select
                        className="w-full"
                        value={presetId}
                        disabled={running}
                        onChange={(value) => {
                            setPresetId(value);
                            setFeedback(undefined);
                        }}
                        options={Object.values(AGENT_VIDEO_PRESETS).map((item) => ({ value: item.id, label: item.label }))}
                    />
                </CardField>
                <CardField label="市场" theme={theme}>
                    <Select
                        className="w-full"
                        value={market}
                        disabled={running}
                        onChange={setMarket}
                        options={Object.values(AGENT_VIDEO_MARKETS).map((item) => ({ value: item.id, label: item.enabled ? item.label : `${item.label}（待开放）`, disabled: !item.enabled }))}
                    />
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
                        setFeedback(undefined);
                    }}
                    options={availableModels.map(({ value, spec }) => ({
                        value,
                        label: (
                            <span className="flex min-w-0 items-center justify-between gap-2">
                                <span className="min-w-0 truncate">{modelOptionLabel(config, value)}</span>
                                <span className="shrink-0 text-xs opacity-60">{spec.durationSeconds} 秒 · {spec.resolution} · {spec.hasAudio ? "有声" : "无声"} · {spec.recommendation}</span>
                            </span>
                        ),
                    }))}
                />
                {selectedModelSpec && selectedModelSpec.durationSeconds < 15 ? (
                    <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        当前模型固定 {selectedModelSpec.durationSeconds} 秒，已自动精简为 3–4 镜；要完整五镜分镜请选 Seedance 15 秒（无声）。
                    </div>
                ) : selectedModelSpec && !selectedModelSpec.hasAudio ? (
                    <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>该模型固定输出无声视频。</div>
                ) : null}
            </CardField>

            <CardField label="尺寸" theme={theme}>
                <Select className="w-full" value={size} disabled={running} onChange={setSize} options={VIDEO_SIZE_OPTIONS.map((item) => ({ value: item.value, label: `${item.label} · ${item.value}` }))} />
            </CardField>

            {presetId === "creator" ? (
                <CardField label="第二张达人图" theme={theme}>
                    <div className="flex items-center gap-2">
                        <div className="size-14 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                            {creatorNode?.metadata?.content || creatorPreviewUrl ? <img src={creatorNode?.metadata?.content || creatorPreviewUrl} alt="达人参考图" className="size-full object-cover" /> : <span className="grid size-full place-items-center" style={{ color: theme.node.muted }}><ImagePlus className="size-4" /></span>}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                            <Select
                                className="w-full"
                                allowClear
                                value={creatorNodeId || undefined}
                                disabled={running}
                                placeholder="从画布选择达人图"
                                onChange={(value) => {
                                    setCreatorNodeId(value || "");
                                    if (value) setCreatorFile(undefined);
                                    setFeedback(undefined);
                                }}
                                options={creatorCandidates.map((node) => ({ value: node.id, label: node.title || node.id }))}
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
                                        setFeedback(undefined);
                                    }
                                    event.target.value = "";
                                }}
                            />
                            <Button size="small" disabled={running} icon={<ImagePlus className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>上传达人图</Button>
                        </div>
                    </div>
                    {!creatorReady ? <div className="mt-1 text-xs text-red-600">请上传达人参考图</div> : null}
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
                {feedback?.kind === "error" && retryModel ? (
                    <Button
                        disabled={running}
                        onClick={() => {
                            setModel(retryModel.value);
                            void generate(retryModel.value);
                        }}
                    >
                        {retryModel.spec.id === "omni_portrait" ? "换 Omni 重试" : "换 Veo 重试"}
                    </Button>
                ) : null}
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
