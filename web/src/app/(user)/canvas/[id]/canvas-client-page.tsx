"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, BookOpen, Bot, CheckCircle2, Clapperboard, Home, ImageIcon, Images, List, Loader2, Menu, Music2, Plus, Redo2, RotateCcw, Settings2, Trash2, Undo2, Upload, Video, XCircle } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestFusionPlacementPlan } from "@/services/api/fusion-placement";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import {
    buildProductDetailImagePrompt,
    buildSceneExpansionImagePrompt,
    buildStoryboardKeyframePrompt,
    buildStoryboardReviewSheetPrompt,
    formatCommerceVideoPlan,
    formatProductBreakdownPlan,
    formatSceneExpansionPlan,
    polishPrompt,
    reverseVideoPrompt,
    type ProductBreakdownPlan,
    type SceneExpansionPlan,
} from "@/services/api/prompt-polish";
import { DOCS_URL } from "@/constant/env";
import { defaultConfig, modelMatchesCapability, modelOptionName, type AiConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { imageToDataUrl, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { buildSceneAwareImageEditPrompt } from "@/lib/fusion-plan-prompt";
import { resolveFusionReferenceRoles } from "@/lib/fusion-reference-roles";
import { buildIdentityPreservingImageEditPrompt } from "@/lib/image-reference-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { buildVideoProductScalePrompt } from "@/lib/video-product-scale";
import { grokVideoReferenceMode, isGrokVideoModel, normalizeModelVideoSeconds, selectGrokReferenceVideoImagesWithPriority, videoAspectRatioForSize } from "@/lib/video-model-settings";
import { buildStoryboardVideoConstraintPrompt, GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, STORYBOARD_DIRECTED_VIDEO_MARKER, unwrapStoryboardVideoUserDirection } from "@/lib/storyboard-video-constraints";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { applyMaskedEditCropDataUrl, applyMaskedEditDataUrl, cropDataUrl, prepareMaskedEditCropDataUrls, splitDataUrl, upscaleDataUrl } from "../utils/canvas-image-data";
import { extractVideoKeyFrames } from "../utils/video-frame-extraction";
import {
    compileStoryboardAudioDirection,
    compileStoryboardCleanAnchorVideoPrompt,
    compileVideoBeatPrompt,
    compileVideoPrompt,
    extractCommerceVideoPlan,
    hasCompleteStoryboardAudioPlan,
    repairStoryboardAudioPlanForDuration,
    resolveStoryboardMode,
    resolveStoryboardVideoPlan,
    storyboardAudioScriptForDuration,
} from "../utils/video-prompt-compiler";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { App, Button, Dropdown, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../constants";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasConfigComposer } from "../components/canvas-config-composer";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CANVAS_AGENT_PANEL_MOTION_MS, CanvasAssistantPanel } from "../components/canvas-assistant-panel";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "../components/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "../components/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "../components/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "../components/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { InfiniteCanvas } from "../components/infinite-canvas";
import { Minimap } from "../components/canvas-mini-map";
import { CanvasNode } from "../components/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "../components/asset-picker-modal";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { CanvasDirectorNode, CanvasDirectorPanel } from "../components/director/canvas-director-node";
import { DirectorStudioDialog } from "../components/director/director-studio-dialog";
import type { DirectorSnapshotPayload } from "../components/director/director-types";
import { useCanvasStore } from "../stores/use-canvas-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { buildCanvasResourceReferences, buildInputMentionReferences, buildNodeMentionReferences, getGenerationResourceNodes } from "../utils/canvas-resource-references";
import { resolveReferenceImageVideoConfig } from "../utils/video-reference-model";
import type { CanvasAgentMode } from "../components/canvas-agent-chat-ui";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasCommerceVideoPlan,
    type CanvasConnection,
    type CanvasImageGenerationType,
    type CanvasFusionPlacementPlan,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "../types";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
    invalidReason?: string;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const STORYBOARD_REVIEW_NODE_MAX_WIDTH = 420;
const STORYBOARD_REVIEW_NODE_MAX_HEIGHT = 720;
const STORYBOARD_REVIEW_COLUMNS = 3;
const STORYBOARD_REVIEW_ROWS = 4;
const STORYBOARD_REVIEW_PANEL_COUNT = STORYBOARD_REVIEW_COLUMNS * STORYBOARD_REVIEW_ROWS;
const STORYBOARD_VIDEO_FRAME_CROP = { x: 0.14, y: 0.055, width: 0.82, height: 0.88 };
const VIDEO_BRIDGE_PRIMARY_TIMEOUT_MS = 120_000;
const VIDEO_BRIDGE_FALLBACK_TIMEOUT_MS = 90_000;
const VIDEO_BRIDGE_FALLBACK_IMAGE_MODELS = ["gemini-3.1-flash-image-2k", "gemini-3.1-flash-image-1k", "gpt-image-2", "grok-imagine-image-lite"] as const;
const STORYBOARD_BRIDGE_MAX_REFERENCES = 8;
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function CanvasEmptyGuide({ theme, onCreateText, onCreateImage, onUpload }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onCreateText: () => void; onCreateImage: () => void; onUpload: () => void }) {
    return (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center px-6">
            <div className="pointer-events-auto w-full max-w-[440px] rounded-2xl border p-5 shadow-2xl backdrop-blur-xl" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
                <div className="text-base font-semibold">从第一张素材开始</div>
                <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>
                    输入一句话、上传产品图，或先放一个图片节点。空白处双击也可以直接写提示词。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={onCreateText}>
                        写提示词
                    </Button>
                    <Button icon={<Upload className="size-4" />} onClick={onUpload}>
                        上传图片
                    </Button>
                    <Button icon={<ImageIcon className="size-4" />} onClick={onCreateImage}>
                        图片节点
                    </Button>
                </div>
            </div>
        </div>
    );
}

function FusionPlacementPlanPreview({ plan }: { plan: CanvasFusionPlacementPlan }) {
    return (
        <div className="max-h-[58vh] overflow-y-auto pr-1 text-sm">
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/70">
                <div className="font-medium text-stone-900 dark:text-stone-100">{plan.scene.summary || "已完成场景理解"}</div>
                <div className="mt-2 grid gap-2 text-xs leading-5 text-stone-600 md:grid-cols-2 dark:text-stone-400">
                    {plan.scene.camera ? <div>镜头：{plan.scene.camera}</div> : null}
                    {plan.scene.light ? <div>光线：{plan.scene.light}</div> : null}
                </div>
                {plan.scene.avoidAreas?.length ? <div className="mt-2 text-xs text-stone-500">避开：{plan.scene.avoidAreas.join("、")}</div> : null}
            </div>
            <div className="mt-3 space-y-3">
                {plan.placements.map((placement, index) => {
                    const product = plan.products.find((item) => item.imageIndex === placement.imageIndex);
                    return (
                        <div key={`${placement.imageIndex}-${index}`} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium text-stone-900 dark:text-stone-100">产品 {index + 1}</div>
                                <div className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">Image {placement.imageIndex}</div>
                            </div>
                            {product?.identity ? <div className="mt-2 text-xs leading-5 text-stone-600 dark:text-stone-400">{product.identity}</div> : null}
                            <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-600 md:grid-cols-2 dark:text-stone-400">
                                <PlanPreviewRow label="位置" value={placement.position} />
                                <PlanPreviewRow label="原因" value={placement.reason} />
                                <PlanPreviewRow label="尺寸" value={placement.scale} />
                                <PlanPreviewRow label="朝向" value={placement.orientation} />
                                <PlanPreviewRow label="接触" value={placement.contact} />
                                <PlanPreviewRow label="阴影" value={placement.shadow} />
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">确认后才会消耗图片生成额度。取消会保留当前节点，可点击重试重新规划。</div>
        </div>
    );
}

function PlanPreviewRow({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <div>
            <span className="font-medium text-stone-700 dark:text-stone-300">{label}：</span>
            {value}
        </div>
    );
}

function ConnectionCreateMenu({
    pending,
    hasVideo,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    hasVideo: boolean;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Director | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Clapperboard className="size-5" />} title="导演台" description="机位、构图和参考帧" onClick={() => onCreate(CanvasNodeType.Director)} />
                {hasVideo ? <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" description="镜头、动作和成片" onClick={() => onCreate(CanvasNodeType.Video)} /> : null}
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

function InfiniteCanvasPage() {
    const { message, modal, notification } = App.useApp();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const projectId = params.id;
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const hasVideoModels = config.videoModels.length > 0;
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const saveStatus = useCanvasStore((state) => state.saveStatus);
    const lastSavedAt = useCanvasStore((state) => state.lastSavedAt);
    const saveError = useCanvasStore((state) => state.saveError);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [directorStudioNodeId, setDirectorStudioNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [assistantCollapsed, setAssistantCollapsed] = useState(true);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const [agentMode, setAgentMode] = useState<CanvasAgentMode>("online");
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const agentCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const undoNotificationKeysRef = useRef<Set<string>>(new Set());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) => prev.map((node) => (affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
    }, []);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    const confirmFusionPlacementPlan = useCallback(
        (plan: CanvasFusionPlacementPlan) =>
            new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "确认融合摆放计划",
                    width: 760,
                    icon: null,
                    content: <FusionPlacementPlanPreview plan={plan} />,
                    okText: "确认融合",
                    cancelText: "取消",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        [modal],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            router.replace("/canvas");
            return;
        }

        const restore = async () => {
            const restoredProject = restoreLegacySceneExpansionBatches(resetInterruptedGeneration(project.nodes), project.connections);
            const restoredNodes = await hydrateCanvasImages(restoredProject.nodes);
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            setConnections(restoredProject.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: restoredProject.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, openProject, projectId, router]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(
        () => () => {
            if (agentCloseTimerRef.current) clearTimeout(agentCloseTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const focusNodesInViewport = useCallback(
        (targetNodes: CanvasNodeData[]) => {
            const visibleTargets = targetNodes.filter(Boolean);
            if (!visibleTargets.length) return;

            const bounds = visibleTargets.reduce(
                (acc, node) => ({
                    left: Math.min(acc.left, node.position.x),
                    top: Math.min(acc.top, node.position.y),
                    right: Math.max(acc.right, node.position.x + node.width),
                    bottom: Math.max(acc.bottom, node.position.y + node.height),
                }),
                { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
            );
            if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.right) || !Number.isFinite(bounds.bottom)) return;

            const rect = containerRef.current?.getBoundingClientRect();
            const width = rect?.width || size.width;
            const height = rect?.height || size.height;
            const padding = 140;
            const availableWidth = Math.max(240, width - padding * 2);
            const availableHeight = Math.max(240, height - padding * 2);
            const boundsWidth = Math.max(1, bounds.right - bounds.left);
            const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
            const fitScale = Math.min(1, availableWidth / boundsWidth, availableHeight / boundsHeight);
            const preferredScale = Math.min(Math.max(viewportRef.current.k, 0.6), 1);
            const nextScale = Math.min(preferredScale, Math.max(0.35, fitScale));
            const centerX = (bounds.left + bounds.right) / 2;
            const centerY = (bounds.top + bounds.bottom) / 2;

            setViewport({
                x: width / 2 - centerX * nextScale,
                y: height / 2 - centerY * nextScale,
                k: nextScale,
            });
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("这两个节点不能这样连接，请换一个可接收的节点");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Director | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("这个新节点不能接在当前位置");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type === CanvasNodeType.Director) setDirectorStudioNodeId(newNode.id);
            else if (type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let invalidReason: string | undefined;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId) {
                        invalidReason ||= "不能连接到自己，请拖到另一个节点，或在空白处松手创建新节点";
                        return;
                    }
                    if (!normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) {
                        invalidReason ||= "这个节点不能接收当前引线，请换一个节点，或在空白处松手创建新节点";
                        return;
                    }

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode, invalidReason };
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const directorStudioNode = directorStudioNodeId ? nodeById.get(directorStudioNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        configInputsById.forEach((inputs, nodeId) => map.set(nodeId, buildInputMentionReferences(inputs)));
        return map;
    }, [configInputsById, connections, nodes]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentProject?.title || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentProject?.title, nodes, projectId, selectedNodeIds, viewport],
    );
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: currentProject?.title || "未命名画布", nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: currentProject?.title || "未命名画布" };
        },
        [currentProject?.title, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: currentProject?.title || "未命名画布" };
    }, [agentUndoSnapshot, currentProject?.title, projectId]);
    const createTextNodeAt = useCallback((position: Position) => {
        const newNode = createCanvasNode(CanvasNodeType.Text, position);
        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([newNode.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(newNode.id);
        setEditingNodeId(newNode.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const createNode = useCallback(
        (type: CanvasNodeType, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            if (type === CanvasNodeType.Text) {
                createTextNodeAt(targetPosition);
                return;
            }
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type === CanvasNodeType.Director) {
                setDirectorStudioNodeId(newNode.id);
                setDialogNodeId(null);
            } else if (type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
        },
        [createTextNodeAt, effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const restoreCanvasSnapshot = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const dismissUndoNotifications = useCallback(() => {
        undoNotificationKeysRef.current.forEach((key) => notification.destroy(key));
        undoNotificationKeysRef.current.clear();
    }, [notification]);

    const showUndoNotification = useCallback(
        (title: string, snapshot: CanvasHistoryEntry, description: string) => {
            const key = `canvas-undo-${nanoid()}`;
            undoNotificationKeysRef.current.add(key);
            notification.open({
                key,
                title,
                description,
                placement: "bottomRight",
                duration: 7,
                onClose: () => {
                    undoNotificationKeysRef.current.delete(key);
                },
                actions: (
                    <Button
                        size="small"
                        icon={<Undo2 className="size-3.5" />}
                        onClick={() => {
                            restoreCanvasSnapshot(snapshot);
                            notification.destroy(key);
                            undoNotificationKeysRef.current.delete(key);
                            message.success("已撤销");
                        }}
                    >
                        撤销
                    </Button>
                ),
            });
        },
        [message, notification, restoreCanvasSnapshot],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const snapshot = createHistoryEntry();
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
            });
            const deletedCount = allIds.size;
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setDirectorStudioNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            showUndoNotification("已删除节点", snapshot, deletedCount > 1 ? `删除了 ${deletedCount} 个节点，可在数秒内撤销。` : "删除了 1 个节点，可在数秒内撤销。");
        },
        [createHistoryEntry, showUndoNotification],
    );

    const deleteConnection = useCallback(
        (connectionId: string) => {
            const snapshot = createHistoryEntry();
            setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
            setSelectedConnectionId((current) => (current === connectionId ? null : current));
            setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
            showUndoNotification("已删除引线", snapshot, "节点还在，连接关系可在数秒内撤销恢复。");
        },
        [createHistoryEntry, showUndoNotification],
    );

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
        setDirectorStudioNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        if (!nodesRef.current.length && !connectionsRef.current.length) {
            setClearConfirmOpen(false);
            return;
        }
        const snapshot = createHistoryEntry();
        const nodeCount = nodesRef.current.length;
        const connectionCount = connectionsRef.current.length;
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setDirectorStudioNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        showUndoNotification("已清空画布", snapshot, `已移除 ${nodeCount} 个节点、${connectionCount} 条引线，可在数秒内撤销。`);
    }, [createHistoryEntry, deselectCanvas, showUndoNotification]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...nextNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => restoreCanvasSnapshot(entry), [restoreCanvasSnapshot]);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        dismissUndoNotifications();
        applyHistory(previous);
    }, [applyHistory, dismissUndoNotifications]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        dismissUndoNotifications();
        applyHistory(next);
    }, [applyHistory, dismissUndoNotifications]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`视觉画布 ${useCanvasStore.getState().projects.length + 1}`);
        router.push(`/canvas/${id}`);
    }, [createProject, router]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        router.push("/canvas");
    }, [cleanupAssetImages, deleteProjects, projectId, router]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleCanvasDoubleClick = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            setContextMenu(null);
            cancelPendingConnectionCreate();
            createTextNodeAt(screenToCanvas(event.clientX, event.clientY));
        },
        [cancelPendingConnectionCreate, createTextNodeAt, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                nextSelected.delete(nodeId);
            } else {
                nextSelected.add(nodeId);
            }
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    if (!initial) return node;
                    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
                }),
            );
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
        const currentViewport = viewportRef.current;

        if (dragRef.current.isDraggingNode) {
            const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
            const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
            const initialPositions = dragRef.current.initialSelectedNodes;
            if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                dragRef.current.hasMoved = true;
            }

            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                setNodes((prev) =>
                    prev.map((node) => {
                        const initial = initialPositions.find((item) => item.id === node.id);
                        return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                    }),
                );
                rafRef.current = null;
            });
            return;
        }
    }, []);

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentConnection = connectingParamsRef.current;
            if (currentConnection && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }

            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [getConnectionDropTarget, screenToCanvas],
    );

    const finishConnectionDrag = useCallback(
        (clientX: number, clientY: number) => {
            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (!currentConnection) return;

            const dropTarget = getConnectionDropTarget(clientX, clientY, currentConnection);
            if (dropTarget.nodeId) {
                connectNodes(currentConnection, dropTarget.nodeId);
                setConnecting(null);
            } else if (dropTarget.isNearNode) {
                message.warning(dropTarget.invalidReason || "没有找到可连接的节点，请拖到节点连接点，或在空白处松手创建新节点");
                setConnecting(null);
            } else {
                const position = screenToCanvas(clientX, clientY);
                setMouseWorld(position);
                pendingConnectionCreateRef.current = { connection: currentConnection, position };
                setPendingConnectionCreate({ connection: currentConnection, position });
            }
        },
        [connectNodes, getConnectionDropTarget, message, screenToCanvas, setConnecting],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            finishConnectionDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);
        },
        [finishConnectionDrag, finishNodeDrag],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            finishConnectionDrag(event.clientX, event.clientY);
        };
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishConnectionDrag, finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createDirectorSnapshotNodes = useCallback(
        async (directorNode: CanvasNodeData, payload: DirectorSnapshotPayload) => {
            const uploaded = await uploadImage(payload.dataUrl);
            const imageSize = fitNodeSize(uploaded.width, uploaded.height, 360, 360);
            const gap = 86;
            const centerY = directorNode.position.y + directorNode.height / 2;
            const imageId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const imageNode: CanvasNodeData = {
                id: imageId,
                type: CanvasNodeType.Image,
                title: `导演参考帧 · ${payload.presetLabel}`,
                position: {
                    x: directorNode.position.x + directorNode.width + gap,
                    y: centerY - imageSize.height / 2,
                },
                width: imageSize.width,
                height: imageSize.height,
                metadata: {
                    ...imageMetadata(uploaded),
                    prompt: payload.prompt,
                    directorReference: true,
                },
            };
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: imageNode.position.x + imageNode.width + gap + configSpec.width / 2,
                    y: centerY,
                },
                {
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: 1,
                    generationMode: "image",
                    prompt: payload.prompt,
                    composerContent: payload.prompt,
                    inputOrder: [imageNode.id],
                    status: NODE_STATUS_IDLE,
                },
            );
            const nextConnections: CanvasConnection[] = [
                { id: nanoid(), fromNodeId: directorNode.id, toNodeId: imageNode.id },
                { id: nanoid(), fromNodeId: imageNode.id, toNodeId: configNode.id },
            ];

            setNodes((prev) => [
                ...prev.map((node) =>
                    node.id === directorNode.id
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  directorLastSnapshot: uploaded.url,
                                  directorLastSnapshotStorageKey: uploaded.storageKey,
                                  directorSnapshotNodeId: imageNode.id,
                                  directorConfigNodeId: configNode.id,
                                  directorPrompt: payload.prompt,
                                  directorPresetId: payload.presetId,
                                  directorMode: payload.mode,
                              },
                          }
                        : node,
                ),
                imageNode,
                configNode,
            ]);
            setConnections((prev) => [...prev, ...nextConnections]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setDirectorStudioNodeId(null);
            window.setTimeout(() => focusNodesInViewport([directorNode, imageNode, configNode]), 60);
            message.success("导演参考帧已创建，并已连接到生图配置");
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, focusNodesInViewport, message],
    );

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactPointerEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? {
                          ...node,
                          width: child.width,
                          height: child.height,
                          metadata: {
                              ...node.metadata,
                              content: child.metadata?.content,
                              primaryImageId: child.id,
                              naturalWidth: child.metadata?.naturalWidth,
                              naturalHeight: child.metadata?.naturalHeight,
                              freeResize: child.metadata?.freeResize,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的素材");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || "画布视频",
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success("已加入我的素材");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success("已加入我的素材");
        },
        [addAsset, message],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: "反推提示词",
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: `参考图片：@[node:${node.id}]\n任务说明：@[node:${textNode.id}]`,
                    },
                ),
                title: "反推提示词配置",
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const createVideoReversePromptNodes = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Video || !node.metadata?.content) {
                message.warning("视频节点为空，无法反推提示词");
                return;
            }

            message.loading({ content: "正在分析视频...", key: "video-reverse", duration: 0 });
            try {
                const frames = await extractVideoKeyFrames(node.metadata.content, { minFrames: 6, maxFrames: 10 });
                if (!frames.length) {
                    message.warning({ content: "未能提取到视频帧", key: "video-reverse" });
                    return;
                }
                const prompt = await reverseVideoPrompt(
                    effectiveConfig,
                    frames.map((frame) => ({ dataUrl: frame.dataUrl, label: frame.label })),
                );
                const gap = 96;
                const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
                const centerY = node.position.y + node.height / 2;
                const textNode = {
                    ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                    title: "视频反推提示词",
                };
                const configNode = {
                    ...createCanvasNode(
                        CanvasNodeType.Config,
                        { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                        {
                            generationMode: "video",
                            model: effectiveConfig.videoModel || defaultConfig.videoModel,
                            prompt,
                            inputOrder: [textNode.id, node.id],
                        },
                    ),
                    title: "视频生成配置",
                };
                const nextNodes = [...nodesRef.current, textNode, configNode];
                const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }];

                nodesRef.current = nextNodes;
                connectionsRef.current = nextConnections;
                setNodes(nextNodes);
                setConnections(nextConnections);
                setSelectedNodeIds(new Set([textNode.id]));
                setSelectedConnectionId(null);
                setDialogNodeId(textNode.id);
                setContextMenu(null);
                setToolbarNodeId(null);
                message.success({ content: `已分析 ${frames.length} 帧并回填视频提示词`, key: "video-reverse" });
            } catch (error) {
                const detail = error instanceof Error ? error.message : "请确认视频可播放且稍后重试";
                message.error({ content: `视频反推失败：${detail}`, key: "video-reverse" });
            }
        },
        [effectiveConfig, message],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const baseGenerationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(baseGenerationConfig, baseGenerationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const displayPrompt = (payload.displayPrompt || userPrompt).trim();
            const prompt = userPrompt;
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const sourceDataUrl = await imageToDataUrl(source);
            const maskCrop = await prepareMaskedEditCropDataUrls(sourceDataUrl, payload.maskDataUrl);
            const generationConfig = { ...baseGenerationConfig, size: resolveMaskEditRequestSizeFromDimensions(maskCrop.width, maskCrop.height) };
            const requestSource = { ...source, name: `${node.title || node.id}-edit-region.png`, dataUrl: maskCrop.sourceDataUrl, storageKey: undefined };
            const requestMask = { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: maskCrop.maskDataUrl };
            const uploadedMask = await uploadImage(payload.maskDataUrl);
            const generationMetadata = {
                ...buildImageGenerationMetadata("edit", generationConfig, 1, [source]),
                size: node.metadata?.size || `${node.metadata?.naturalWidth || 1024}x${node.metadata?.naturalHeight || 1024}`,
                editMask: uploadedMask.storageKey || uploadedMask.url,
                editRequestSize: generationConfig.size,
            };
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: displayPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, displayPrompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [requestSource], requestMask, { signal: controller.signal }).then((items) => items[0]);
                const compositedDataUrl = await applyMaskedEditCropDataUrl(sourceDataUrl, image.dataUrl, payload.maskDataUrl, maskCrop);
                const uploaded = await uploadImage(compositedDataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, displayPrompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                setDialogNodeId(childId);
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    undefined,
                    { signal: controller.signal },
                ).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) return;

            if (target?.nodeId) {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: file.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: file.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? {
                                  ...node,
                                  type: CanvasNodeType.Image,
                                  title: file.name,
                                  width: size.width,
                                  height: size.height,
                                  metadata: {
                                      ...node.metadata,
                                      ...imageMetadata(image),
                                      errorDetails: undefined,
                                      freeResize: false,
                                      isBatchRoot: undefined,
                                      batchRootId: undefined,
                                      batchChildIds: undefined,
                                      batchUsesReferenceImages: undefined,
                                      generationType: undefined,
                                      model: undefined,
                                      size: undefined,
                                      quality: undefined,
                                      count: undefined,
                                      references: undefined,
                                      primaryImageId: undefined,
                                      imageBatchExpanded: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (isAudioFile(file) ? createAudioFileNode(file, pos) : file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const pasteAssistantImage = useCallback(
        (file: File) => {
            const position = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            void createImageFileNode(file, position);
            message.success("已从剪切板添加图片");
        },
        [createImageFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateProductBreakdown = useCallback(
        async (nodeId: string, plan: ProductBreakdownPlan) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (!sourceNode) throw new Error("找不到产品参考图节点");
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, sourceNode, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                throw new Error("请先配置可用的生图模型");
            }

            const generationContext = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, ""));
            const referenceImages = mergeReferenceImages(sourceNodeReferenceImages(sourceNode), generationContext.referenceImages);
            if (!referenceImages.length) throw new Error("没有读取到产品参考图，无法生成细节图");

            const shots = plan.shots;
            if (!shots.length) throw new Error("产品拆解没有可生成的细节镜头");
            setRunningNodeId(nodeId);
            const controller = startGenerationRequest(nodeId, nodeId, nodeId);
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const gap = 96;
            const rowGap = 36;
            const analysisId = nanoid();
            const rootId = nanoid();
            const childIds = shots.slice(1).map(() => nanoid());
            const targetIds = [rootId, ...childIds];
            const analysisText = formatProductBreakdownPlan(plan);
            const analysisNode: CanvasNodeData = {
                id: analysisId,
                type: CanvasNodeType.Text,
                title: `${plan.productName} 产品拆解`,
                position: { x: sourceNode.position.x + sourceNode.width + gap, y: sourceNode.position.y },
                width: textSpec.width,
                height: textSpec.height,
                metadata: { content: analysisText, prompt: analysisText, status: NODE_STATUS_SUCCESS, fontSize: 14, productBreakdown: true },
            };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);
            const rootNode: CanvasNodeData = {
                id: rootId,
                type: CanvasNodeType.Image,
                title: shots[0].title,
                position: { x: analysisNode.position.x + analysisNode.width + gap, y: sourceNode.position.y },
                width: imageSpec.width,
                height: imageSpec.height,
                metadata: {
                    ...generationMetadata,
                    prompt: buildProductDetailImagePrompt(plan, shots[0]),
                    status: NODE_STATUS_LOADING,
                    isBatchRoot: childIds.length > 0,
                    batchChildIds: childIds.length > 0 ? childIds : undefined,
                    batchUsesReferenceImages: true,
                    imageBatchExpanded: childIds.length > 0 ? true : undefined,
                    productBreakdown: true,
                    productDetailShot: true,
                    productDetailTitle: shots[0].title,
                    count: shots.length,
                },
            };
            const childNodes = childIds.map((id, index): CanvasNodeData => {
                const shot = shots[index + 1];
                const shotPrompt = buildProductDetailImagePrompt(plan, shot, index + 1);
                return {
                    id,
                    type: CanvasNodeType.Image,
                    title: shot.title,
                    position: {
                        x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageSpec.width + 36),
                        y: rootNode.position.y + Math.floor(index / 2) * (imageSpec.height + rowGap),
                    },
                    width: imageSpec.width,
                    height: imageSpec.height,
                    metadata: {
                        prompt: shotPrompt,
                        status: NODE_STATUS_LOADING,
                        batchRootId: rootId,
                        productDetailShot: true,
                        productDetailTitle: shot.title,
                        ...generationMetadata,
                    },
                };
            });
            const nextConnections: CanvasConnection[] = [
                { id: nanoid(), fromNodeId: nodeId, toNodeId: analysisId },
                { id: nanoid(), fromNodeId: analysisId, toNodeId: rootId },
                ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
            ];

            setNodes((prev) => [...prev, analysisNode, rootNode, ...childNodes]);
            setConnections((prev) => [...prev, ...nextConnections]);
            setSelectedNodeIds(new Set([rootId]));
            setSelectedConnectionId(null);
            targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));

            let hasSuccess = false;
            let hasFailure = false;
            try {
                await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                    const shot = shots[index];
                    const shotPrompt = buildProductDetailImagePrompt(plan, shot, index);
                    try {
                        const image = await requestEdit(generationConfig, shotPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                        setNodes((prev) =>
                            prev.map((node) => {
                                if (node.id === targetId) {
                                    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        width: imageSize.width,
                                        height: imageSize.height,
                                        metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: shotPrompt },
                                    };
                                }
                                return node;
                            }),
                        );
                        hasSuccess = true;
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        hasFailure = true;
                        const errorDetails = error instanceof Error ? error.message : "细节图生成失败";
                        setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
                });
                if (controller.signal.aborted) return;
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === rootId
                            ? {
                                  ...node,
                                  metadata: {
                                      ...node.metadata,
                                      status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: hasSuccess ? undefined : "全部细节图生成失败",
                                  },
                              }
                            : node,
                    ),
                );
                if (!hasFailure) message.success(`${shots.length} 张产品细节拆解图已生成`);
                else message.error(hasSuccess ? "部分细节图生成失败，可单独重试" : "全部细节图生成失败");
            } finally {
                finishGenerationRequest(rootId, controller);
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const handleGenerateSceneExpansion = useCallback(
        async (nodeId: string, plan: SceneExpansionPlan) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (!sourceNode) throw new Error("找不到产品参考图节点");
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, sourceNode, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                throw new Error("请先配置可用的生图模型");
            }

            const generationContext = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, ""));
            const referenceImages = mergeReferenceImages(sourceNodeReferenceImages(sourceNode), generationContext.referenceImages);
            if (!referenceImages.length) throw new Error("没有读取到产品参考图，无法生成场景图");

            const scenes = plan.scenes;
            if (!scenes.length) throw new Error("场景扩展没有可生成的场景");
            setRunningNodeId(nodeId);
            const controller = startGenerationRequest(nodeId, nodeId, nodeId);
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const gap = 96;
            const rowGap = 36;
            const analysisId = nanoid();
            const rootId = nanoid();
            const childIds = scenes.slice(1).map(() => nanoid());
            const targetIds = [rootId, ...childIds];
            const analysisText = formatSceneExpansionPlan(plan);
            const analysisNode: CanvasNodeData = {
                id: analysisId,
                type: CanvasNodeType.Text,
                title: `${plan.productName} 场景扩展`,
                position: { x: sourceNode.position.x + sourceNode.width + gap, y: sourceNode.position.y },
                width: textSpec.width,
                height: textSpec.height,
                metadata: { content: analysisText, prompt: analysisText, status: NODE_STATUS_SUCCESS, fontSize: 14, sceneExpansion: true },
            };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);
            const rootScene = scenes[0];
            const rootPrompt = buildSceneExpansionImagePrompt(plan, rootScene);
            const rootNode: CanvasNodeData = {
                id: rootId,
                type: CanvasNodeType.Image,
                title: rootScene.title,
                position: { x: analysisNode.position.x + analysisNode.width + gap, y: analysisNode.position.y },
                width: imageSpec.width,
                height: imageSpec.height,
                metadata: {
                    ...generationMetadata,
                    prompt: rootPrompt,
                    status: NODE_STATUS_LOADING,
                    isBatchRoot: childIds.length > 0,
                    batchChildIds: childIds.length > 0 ? childIds : undefined,
                    batchUsesReferenceImages: true,
                    imageBatchExpanded: childIds.length > 0 ? true : undefined,
                    count: scenes.length,
                    sceneExpansion: true,
                    sceneExpansionTitle: rootScene.title,
                },
            };
            const childNodes = childIds.map((id, index): CanvasNodeData => {
                const scene = scenes[index + 1];
                const scenePrompt = buildSceneExpansionImagePrompt(plan, scene);
                return {
                    id,
                    type: CanvasNodeType.Image,
                    title: scene.title,
                    position: {
                        x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageSpec.width + 36),
                        y: rootNode.position.y + Math.floor(index / 2) * (imageSpec.height + rowGap),
                    },
                    width: imageSpec.width,
                    height: imageSpec.height,
                    metadata: {
                        ...generationMetadata,
                        prompt: scenePrompt,
                        status: NODE_STATUS_LOADING,
                        batchRootId: rootId,
                        sceneExpansion: true,
                        sceneExpansionTitle: scene.title,
                    },
                };
            });
            const nextConnections: CanvasConnection[] = [
                { id: nanoid(), fromNodeId: nodeId, toNodeId: analysisId },
                { id: nanoid(), fromNodeId: analysisId, toNodeId: rootId },
                ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
            ];

            setNodes((prev) => [...prev, analysisNode, rootNode, ...childNodes]);
            setConnections((prev) => [...prev, ...nextConnections]);
            setSelectedNodeIds(new Set([rootId]));
            setSelectedConnectionId(null);
            targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));

            let successCount = 0;
            try {
                await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                    const scene = scenes[index];
                    const scenePrompt = buildSceneExpansionImagePrompt(plan, scene);
                    try {
                        const image = await requestEdit(generationConfig, scenePrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                        setNodes((prev) =>
                            prev.map((node) => {
                                if (node.id !== targetId) return node;
                                const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                return {
                                    ...node,
                                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scenePrompt },
                                };
                            }),
                        );
                        successCount += 1;
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        const errorDetails = error instanceof Error ? error.message : "场景图生成失败";
                        setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
                });
                if (controller.signal.aborted) return;
                if (successCount === scenes.length) message.success(`${successCount} 张独立场景图已生成`);
                else if (successCount > 0) message.error(`已生成 ${successCount} 张，${scenes.length - successCount} 张失败，可单独重试`);
                else message.error("全部场景图生成失败");
            } finally {
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const handleGenerateVideoStoryboard = useCallback(
        async (nodeId: string, plan: CanvasCommerceVideoPlan) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (!sourceNode) throw new Error("找不到源节点");
            const baseGenerationConfig = buildGenerationConfig(effectiveConfig, sourceNode, "image");
            const reviewSheetCount = Math.max(1, Math.min(4, getGenerationCount(baseGenerationConfig.count)));
            const generationConfig = { ...baseGenerationConfig, count: "1" };
            const reviewSheetConfig = { ...generationConfig, size: "1024x1536" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                throw new Error("请先配置可用的生图模型");
            }

            const generationContext = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, ""));
            const referenceImages = mergeReferenceImages(sourceNodeReferenceImages(sourceNode), generationContext.referenceImages);

            const beats = plan.beats;
            if (!beats?.length) throw new Error("视频分镜没有可生成的 beat");
            setRunningNodeId(nodeId);
            const controller = startGenerationRequest(nodeId, nodeId, nodeId);
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const gap = 96;
            const rowGap = 36;
            const planId = nanoid();
            const analysisId = nanoid();
            const rootId = nanoid();
            const childIds = Array.from({ length: Math.max(0, reviewSheetCount - 1) }, () => nanoid());
            const targetIds = [rootId, ...childIds];
            const reviewPrompts = Array.from({ length: reviewSheetCount }, (_, index) => buildStoryboardReviewSheetPrompt(plan, index + 1));

            const analysisText = formatCommerceVideoPlan(plan);
            const analysisNode: CanvasNodeData = {
                id: analysisId,
                type: CanvasNodeType.Text,
                title: `${plan.productCategory || "产品"} 视频分镜规划`,
                position: { x: sourceNode.position.x + sourceNode.width + gap, y: sourceNode.position.y },
                width: textSpec.width,
                height: textSpec.height,
                metadata: {
                    content: analysisText,
                    prompt: analysisText,
                    status: NODE_STATUS_SUCCESS,
                    fontSize: 14,
                    storyboardPlanId: planId,
                    storyboardSourceNodeId: nodeId,
                    commerceVideoPlan: plan,
                },
            };

            const generationMetadata = buildImageGenerationMetadata(referenceImages.length > 0 ? "edit" : "generation", reviewSheetConfig, 1, referenceImages);
            const rootPrompt = reviewPrompts[0];
            const rootNode: CanvasNodeData = {
                id: rootId,
                type: CanvasNodeType.Image,
                title: "12宫格分镜候选 1",
                position: { x: analysisNode.position.x + analysisNode.width + gap, y: analysisNode.position.y },
                width: 360,
                height: 630,
                metadata: {
                    ...generationMetadata,
                    prompt: rootPrompt,
                    status: NODE_STATUS_LOADING,
                    isBatchRoot: childIds.length > 0,
                    batchChildIds: childIds.length > 0 ? childIds : undefined,
                    batchUsesReferenceImages: referenceImages.length > 0,
                    imageBatchExpanded: childIds.length > 0 ? true : undefined,
                    count: reviewSheetCount,
                    storyboardRole: "review-sheet" as const,
                    storyboardPlanId: planId,
                    storyboardSourceNodeId: nodeId,
                    storyboardReviewIndex: 1,
                    commerceVideoPlan: plan,
                },
            };
            const childNodes = childIds.map((id, index): CanvasNodeData => {
                const reviewPrompt = reviewPrompts[index + 1];
                return {
                    id,
                    type: CanvasNodeType.Image,
                    title: `12宫格分镜候选 ${index + 2}`,
                    position: {
                        x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (rootNode.width + 36),
                        y: rootNode.position.y + Math.floor(index / 2) * (rootNode.height + rowGap),
                    },
                    width: rootNode.width,
                    height: rootNode.height,
                    metadata: {
                        ...generationMetadata,
                        prompt: reviewPrompt,
                        status: NODE_STATUS_LOADING,
                        batchRootId: rootId,
                        storyboardRole: "review-sheet" as const,
                        storyboardPlanId: planId,
                        storyboardSourceNodeId: nodeId,
                        storyboardReviewIndex: index + 2,
                        commerceVideoPlan: plan,
                    },
                };
            });

            const nextConnections: CanvasConnection[] = [
                { id: nanoid(), fromNodeId: nodeId, toNodeId: analysisId },
                { id: nanoid(), fromNodeId: analysisId, toNodeId: rootId },
                ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
            ];

            setNodes((prev) => [...prev, analysisNode, rootNode, ...childNodes]);
            setConnections((prev) => [...prev, ...nextConnections]);
            setSelectedNodeIds(new Set([rootId]));
            setSelectedConnectionId(null);
            focusNodesInViewport([analysisNode, rootNode, ...childNodes]);
            targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));

            let successCount = 0;
            try {
                const useEdit = referenceImages.length > 0;
                await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                    const reviewPrompt = reviewPrompts[index] || reviewPrompts[0];
                    try {
                        const image = useEdit
                            ? await requestEdit(reviewSheetConfig, reviewPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0])
                            : await requestGeneration(reviewSheetConfig, reviewPrompt, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        const imageSize = fitNodeSize(uploaded.width, uploaded.height, STORYBOARD_REVIEW_NODE_MAX_WIDTH, STORYBOARD_REVIEW_NODE_MAX_HEIGHT);
                        setNodes((prev) => {
                            const root = prev.find((node) => node.id === rootId);
                            return prev.map((node) => {
                                if (node.id !== targetId && node.id !== rootId) return node;
                                const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        width: imageSize.width,
                                        height: imageSize.height,
                                        metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: reviewPrompt, primaryImageId: targetId },
                                    };
                                if (node.id === targetId)
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        width: imageSize.width,
                                        height: imageSize.height,
                                        metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: reviewPrompt },
                                    };
                                return node;
                            });
                        });
                        successCount += 1;
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        const errorDetails = error instanceof Error ? error.message : "12宫格分镜生成失败";
                        setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
                });
                if (controller.signal.aborted) return;
                if (successCount === reviewSheetCount) message.success(`${successCount} 张12宫格分镜候选已生成，请选择一张生成关键帧`);
                else if (successCount > 0) message.error(`已生成 ${successCount} 张，${reviewSheetCount - successCount} 张失败，可单独重试`);
                else message.error("全部12宫格分镜生成失败");
            } finally {
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, focusNodesInViewport, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const handleGenerateStoryboardKeyframes = useCallback(
        async (reviewNode: CanvasNodeData) => {
            const plan = reviewNode.metadata?.commerceVideoPlan;
            if (!plan?.beats?.length) {
                message.error("找不到分镜规划数据");
                return;
            }
            const planId = reviewNode.metadata?.storyboardPlanId;
            if (!planId || reviewNode.metadata?.storyboardRole !== "review-sheet") {
                message.error("请选择12宫格分镜候选图生成关键帧");
                return;
            }
            const reviewImageUrl = reviewNode.metadata?.content;
            if (!reviewImageUrl) {
                message.error("这张12宫格还没有生成完成");
                return;
            }

            const sourceNode = reviewNode.metadata?.storyboardSourceNodeId ? nodesRef.current.find((node) => node.id === reviewNode.metadata?.storyboardSourceNodeId) || null : null;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, sourceNode || reviewNode, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const sourceContext = sourceNode ? await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, "")) : { referenceImages: [] as ReferenceImage[] };
            const sourceReferences = sourceNode ? mergeReferenceImages(sourceNodeReferenceImages(sourceNode), sourceContext.referenceImages) : [];
            const reviewReference: ReferenceImage = {
                id: reviewNode.id,
                name: `storyboard-review-${reviewNode.metadata?.storyboardReviewIndex || 1}.png`,
                type: reviewNode.metadata?.mimeType || "image/png",
                dataUrl: reviewImageUrl,
                storageKey: reviewNode.metadata?.storageKey || (reviewImageUrl.startsWith("image:") ? reviewImageUrl : undefined),
                url: reviewImageUrl.startsWith("http") ? reviewImageUrl : undefined,
            };
            const referenceImages = mergeReferenceImages(sourceReferences, [reviewReference]);
            const beats = plan.beats;
            const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const gap = 96;
            const rowGap = 36;
            const rootId = nanoid();
            const childIds = beats.slice(1).map(() => nanoid());
            const targetIds = [rootId, ...childIds];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);

            const buildBeatPrompt = (beat: NonNullable<CanvasCommerceVideoPlan["beats"]>[number]) => buildStoryboardKeyframePrompt(plan, beat, { selectedReviewSheet: true });
            const rootBeat = beats[0];
            const rootPrompt = buildBeatPrompt(rootBeat);
            const rootNode: CanvasNodeData = {
                id: rootId,
                type: CanvasNodeType.Image,
                title: `关键帧 Beat ${rootBeat.index} | ${rootBeat.phase} | ${rootBeat.timeRange}`,
                position: { x: reviewNode.position.x + reviewNode.width + gap, y: reviewNode.position.y },
                width: imageSpec.width,
                height: imageSpec.height,
                metadata: {
                    ...generationMetadata,
                    prompt: rootPrompt,
                    status: NODE_STATUS_LOADING,
                    isBatchRoot: childIds.length > 0,
                    batchChildIds: childIds.length > 0 ? childIds : undefined,
                    batchUsesReferenceImages: true,
                    imageBatchExpanded: childIds.length > 0 ? true : undefined,
                    count: beats.length,
                    storyboardRole: "keyframe" as const,
                    storyboardBeatIndex: 0,
                    storyboardPlanId: planId,
                    storyboardSourceNodeId: reviewNode.metadata?.storyboardSourceNodeId,
                    storyboardReviewNodeId: reviewNode.id,
                    storyboardReviewIndex: reviewNode.metadata?.storyboardReviewIndex,
                },
            };
            const childNodes = childIds.map((id, index): CanvasNodeData => {
                const beat = beats[index + 1];
                const beatPrompt = buildBeatPrompt(beat);
                return {
                    id,
                    type: CanvasNodeType.Image,
                    title: `关键帧 Beat ${beat.index} | ${beat.phase} | ${beat.timeRange}`,
                    position: {
                        x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageSpec.width + 36),
                        y: rootNode.position.y + Math.floor(index / 2) * (imageSpec.height + rowGap),
                    },
                    width: imageSpec.width,
                    height: imageSpec.height,
                    metadata: {
                        ...generationMetadata,
                        prompt: beatPrompt,
                        status: NODE_STATUS_LOADING,
                        batchRootId: rootId,
                        storyboardRole: "keyframe" as const,
                        storyboardBeatIndex: index + 1,
                        storyboardPlanId: planId,
                        storyboardSourceNodeId: reviewNode.metadata?.storyboardSourceNodeId,
                        storyboardReviewNodeId: reviewNode.id,
                        storyboardReviewIndex: reviewNode.metadata?.storyboardReviewIndex,
                    },
                };
            });
            const nextConnections: CanvasConnection[] = [{ id: nanoid(), fromNodeId: reviewNode.id, toNodeId: rootId }, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

            setRunningNodeId(reviewNode.id);
            const controller = startGenerationRequest(reviewNode.id, reviewNode.id, reviewNode.id);
            setNodes((prev) => [...prev, rootNode, ...childNodes]);
            setConnections((prev) => [...prev, ...nextConnections]);
            setSelectedNodeIds(new Set([rootId]));
            setSelectedConnectionId(null);
            focusNodesInViewport([reviewNode, rootNode, ...childNodes]);
            targetIds.forEach((targetId) => startGenerationRequest(targetId, reviewNode.id, reviewNode.id, controller));

            let successCount = 0;
            try {
                await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                    const beat = beats[index];
                    const beatPrompt = buildBeatPrompt(beat);
                    try {
                        const image = await requestEdit(generationConfig, beatPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                        setNodes((prev) => {
                            const root = prev.find((node) => node.id === rootId);
                            return prev.map((node) => {
                                if (node.id !== targetId && node.id !== rootId) return node;
                                const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        width: imageSize.width,
                                        height: imageSize.height,
                                        metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: beatPrompt, primaryImageId: targetId },
                                    };
                                if (node.id === targetId)
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        width: imageSize.width,
                                        height: imageSize.height,
                                        metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: beatPrompt },
                                    };
                                return node;
                            });
                        });
                        successCount += 1;
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        const errorDetails = error instanceof Error ? error.message : "关键帧生成失败";
                        setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
                });
                if (controller.signal.aborted) return;
                if (successCount === beats.length) message.success(`${successCount} 张干净关键帧已生成，可从分镜规划节点生成视频`);
                else if (successCount > 0) message.error(`已生成 ${successCount} 张，${beats.length - successCount} 张失败，可单独重试`);
                else message.error("全部关键帧生成失败");
            } finally {
                finishGenerationRequest(reviewNode.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, focusNodesInViewport, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const handleGenerateVideoClips = useCallback(
        async (planNode: CanvasNodeData) => {
            if (generationRequestsRef.current.has(planNode.id)) {
                message.warning("视频片段正在生成，请勿重复提交");
                return;
            }
            const plan = planNode.metadata?.commerceVideoPlan;
            if (!plan?.beats?.length) throw new Error("找不到分镜规划数据");
            const planId = planNode.metadata?.storyboardPlanId;
            if (!planId) throw new Error("找不到分镜规划 ID");

            const generationConfig = { ...buildGenerationConfig(effectiveConfig, planNode, "video"), count: "1" };
            if (!generationConfig.videoModels.length) {
                message.error("当前令牌未开放视频模型，无法生成视频片段");
                return;
            }

            const keyframeNodes = nodesRef.current
                .filter((node) => node.metadata?.storyboardPlanId === planId && node.metadata?.storyboardRole === "keyframe" && node.metadata?.content)
                .sort((a, b) => (a.metadata?.storyboardBeatIndex ?? 0) - (b.metadata?.storyboardBeatIndex ?? 0));

            if (!keyframeNodes.length) {
                message.error("找不到已生成的关键帧图片，请先生成关键帧");
                return;
            }

            const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const gap = 96;
            setRunningNodeId(planNode.id);
            const controller = startGenerationRequest(planNode.id, planNode.id, planNode.id);
            const videoModel = generationConfig.videoModel || generationConfig.model || effectiveConfig.videoModel || effectiveConfig.model;
            const videoSeconds = normalizeModelVideoSeconds(generationConfig.videoSeconds, videoModel);
            const videoPromptContext = {
                model: "grok",
                duration: Number(videoSeconds),
                aspectRatio: videoAspectRatioForSize(generationConfig.size),
                referenceMode: "i2v",
            } as const;

            const videoEntries = keyframeNodes.map((kfNode, index) => {
                const beat = plan.beats![index] || plan.beats![plan.beats!.length - 1];
                const clipPrompt = compileVideoBeatPrompt(plan, beat, videoPromptContext);
                const videoId = nanoid();
                const videoNode: CanvasNodeData = {
                    id: videoId,
                    type: CanvasNodeType.Video,
                    title: `Beat ${beat.index} | ${beat.phase} | ${beat.timeRange}`,
                    position: { x: kfNode.position.x + kfNode.width + gap, y: kfNode.position.y },
                    width: videoSpec.width,
                    height: videoSpec.height,
                    metadata: {
                        prompt: clipPrompt,
                        status: NODE_STATUS_LOADING,
                        model: videoModel,
                        size: generationConfig.size,
                        seconds: videoSeconds,
                        vquality: generationConfig.vquality,
                        productScaleMode: generationConfig.videoProductScaleMode,
                        generateAudio: generationConfig.videoGenerateAudio,
                        watermark: generationConfig.videoWatermark,
                        storyboardPlanId: planId,
                        storyboardBeatIndex: beat.index,
                    },
                };
                return { kfNode, beat, clipPrompt, videoId, videoNode };
            });

            const videoIds = videoEntries.map((entry) => entry.videoId);
            const newConnections: CanvasConnection[] = videoEntries.map((entry) => ({
                id: nanoid(),
                fromNodeId: entry.kfNode.id,
                toNodeId: entry.videoId,
            }));

            setNodes((prev) => [...prev, ...videoEntries.map((entry) => entry.videoNode)]);
            setConnections((prev) => [...prev, ...newConnections]);
            videoIds.forEach((videoId) => startGenerationRequest(videoId, planNode.id, planNode.id, controller));

            let successCount = 0;
            try {
                await runWithConcurrency(videoIds, 1, async (videoId, index) => {
                    const entry = videoEntries[index];
                    const referenceImages = sourceNodeReferenceImages(entry.kfNode);
                    try {
                        const video = await storeGeneratedVideo(await requestVideoGeneration({ ...generationConfig, model: videoModel, videoModel, videoSeconds }, entry.clipPrompt, referenceImages, [], [], { signal: controller.signal }));
                        const videoSize = fitNodeSize(video.width || videoSpec.width, video.height || videoSpec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) => {
                                if (node.id !== videoId) return node;
                                return {
                                    ...node,
                                    width: videoSize.width,
                                    height: videoSize.height,
                                    position: {
                                        x: node.position.x + node.width / 2 - videoSize.width / 2,
                                        y: node.position.y + node.height / 2 - videoSize.height / 2,
                                    },
                                    metadata: { ...node.metadata, ...videoMetadata(video), prompt: entry.clipPrompt },
                                };
                            }),
                        );
                        successCount += 1;
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        const errorDetails = error instanceof Error ? error.message : "视频片段生成失败";
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                });
                if (controller.signal.aborted) return;
                if (successCount === videoEntries.length) message.success(`${successCount} 个视频片段已生成`);
                else if (successCount > 0) message.error(`已生成 ${successCount} 个，${videoEntries.length - successCount} 个失败，可单独重试`);
                else message.error("全部视频片段生成失败");
            } finally {
                finishGenerationRequest(planNode.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, message, startGenerationRequest],
    );

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (generationRequestsRef.current.has(nodeId) || sourceNode?.metadata?.status === NODE_STATUS_LOADING) {
                message.info("当前节点正在生成，请稍等完成后再操作");
                return;
            }
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference = sourceNodeReferenceImages(sourceNode || null);
                    const referenceImages = mergeReferenceImages(sourceReference, generationContext.referenceImages);
                    const hasDirectorBlueprintReference = referenceImages.some((image) => nodesRef.current.find((node) => node.id === image.id)?.metadata?.directorReference);
                    const fusionReferenceRoles = hasDirectorBlueprintReference
                        ? null
                        : resolveFusionReferenceRoles({
                              prompt: effectivePrompt,
                              references: referenceImages,
                              explicitSceneImageId: sourceReference[0]?.id,
                              force: sourceReference.length > 0 && referenceImages.length > sourceReference.length,
                          });
                    const requestReferenceImages = fusionReferenceRoles?.orderedImages || referenceImages;
                    const persistedImagePrompt = fusionReferenceRoles?.prompt || effectivePrompt;
                    let requestPrompt = hasDirectorBlueprintReference ? buildDirectorBlueprintImageEditPrompt(effectivePrompt) : buildIdentityPreservingImageEditPrompt(effectivePrompt, sourceReference.length > 0, requestReferenceImages);
                    let fusionPlacementPlan: CanvasFusionPlacementPlan | undefined;
                    const generationType = requestReferenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, requestReferenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    const canUseFusionPlacementPlanner = Boolean(fusionReferenceRoles);
                    const initialImageStatusMessage = requestReferenceImages.length ? (canUseFusionPlacementPlanner ? "分析场景..." : "处理参考图...") : undefined;
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: persistedImagePrompt,
                            status: NODE_STATUS_LOADING,
                            statusMessage: initialImageStatusMessage,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: persistedImagePrompt, status: NODE_STATUS_LOADING, statusMessage: initialImageStatusMessage, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    const stageNodeIds = new Set([rootId, ...targetIds]);
                    const updateImageGenerationStage = (statusMessage: string) => {
                        setNodes((prev) => prev.map((node) => (stageNodeIds.has(node.id) ? { ...node, metadata: { ...node.metadata, statusMessage } } : node)));
                    };
                    if (requestReferenceImages.length) {
                        if (canUseFusionPlacementPlanner) {
                            try {
                                updateImageGenerationStage("分析场景...");
                                const productReferenceImages = fusionReferenceRoles!.productImages;
                                const plan = await requestFusionPlacementPlan(generationConfig, fusionReferenceRoles!.sceneImage, productReferenceImages, {
                                    signal: controller.signal,
                                    userPrompt: fusionReferenceRoles!.prompt,
                                });
                                if (controller.signal.aborted) throw new Error("请求已取消");
                                updateImageGenerationStage("规划摆放...");
                                const approved = await confirmFusionPlacementPlan(plan);
                                if (controller.signal.aborted) throw new Error("请求已取消");
                                if (!approved) {
                                    const cancelMessage = "已取消融合。请重试后确认摆放计划，再生成合成图。";
                                    setNodes((prev) =>
                                        prev.map((node) =>
                                            stageNodeIds.has(node.id) || (node.id === nodeId && isConfigNode)
                                                ? {
                                                      ...node,
                                                      metadata: {
                                                          ...node.metadata,
                                                          status: NODE_STATUS_ERROR,
                                                          statusMessage: undefined,
                                                          errorDetails: cancelMessage,
                                                          fusionPlacementPlanV1: plan,
                                                      },
                                                  }
                                                : node,
                                        ),
                                    );
                                    message.info("已取消融合生成");
                                    targetIds.forEach((targetId) => finishGenerationRequest(targetId, controller));
                                    if (count > 1) finishGenerationRequest(rootId, controller);
                                    return;
                                }
                                fusionPlacementPlan = plan;
                                setNodes((prev) =>
                                    prev.map((node) => {
                                        const productIndex = productReferenceImages.findIndex((image) => image.id === node.id);
                                        const product = productIndex >= 0 ? plan.products[productIndex] : null;
                                        if (!product) return node;
                                        return {
                                            ...node,
                                            metadata: {
                                                ...node.metadata,
                                                productIdentityV1: {
                                                    fingerprint: referenceFingerprint(productReferenceImages[productIndex]),
                                                    model: plan.plannerModel,
                                                    identity: product.identity,
                                                    colors: product.colors,
                                                    materials: product.materials,
                                                    labelLayout: product.labelLayout,
                                                    observedText: product.observedText,
                                                    textStatus: product.textStatus,
                                                },
                                            },
                                        };
                                    }),
                                );
                                requestPrompt = buildSceneAwareImageEditPrompt(plan, fusionReferenceRoles!.prompt);
                                updateImageGenerationStage("融合产品...");
                            } catch (error) {
                                if (controller.signal.aborted) throw new Error("请求已取消");
                                if (isGenerationCanceled(error)) throw error;
                                const plannerError = fusionPlacementPlannerErrorMessage(error);
                                console.warn("[canvas] fusion placement planner failed", error);
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        stageNodeIds.has(node.id) || (node.id === nodeId && isConfigNode)
                                            ? {
                                                  ...node,
                                                  metadata: {
                                                      ...node.metadata,
                                                      status: NODE_STATUS_ERROR,
                                                      statusMessage: undefined,
                                                      errorDetails: plannerError,
                                                      fusionPlacementPlanV1: undefined,
                                                  },
                                              }
                                            : node,
                                    ),
                                );
                                message.error(plannerError);
                                targetIds.forEach((targetId) => finishGenerationRequest(targetId, controller));
                                if (count > 1) finishGenerationRequest(rootId, controller);
                                return;
                            }
                        } else {
                            updateImageGenerationStage("融合产品...");
                        }
                    }
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstFailureDetails = "";
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            try {
                                const image = requestReferenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, requestPrompt, requestReferenceImages, undefined, { signal: controller.signal }).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, { signal: controller.signal }).then((items) => items[0]);
                                const uploaded = await uploadImage(image.dataUrl);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId, statusMessage: undefined, fusionPlacementPlanV1: fusionPlacementPlan },
                                            };
                                        if (node.id === targetId)
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), statusMessage: undefined, fusionPlacementPlanV1: fusionPlacementPlan },
                                            };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                if (!firstFailureDetails) firstFailureDetails = errorDetails;
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    const failureDetails = firstFailureDetails || "全部图片生成失败";
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : failureDetails } }
                                : node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : failureDetails } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: failureDetails } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    if (!generationConfig.videoModels.length) throw new Error("当前令牌未开放视频模型");
                    const storyboardReviewSheetImages = storyboardReviewSheetWholeReferences(nodeId, nodesRef.current, connectionsRef.current);
                    const usesWholeStoryboardSheet = storyboardReviewSheetImages.length > 0 || isStoredWholeStoryboardVideo(sourceNode);
                    const storyboardIdentityImages = await storyboardReviewSheetIdentityReferences(nodeId, nodesRef.current, connectionsRef.current);
                    const storyboardKeyframeAnchorImages = usesWholeStoryboardSheet ? storyboardReviewSheetKeyframeAnchorReferences(nodeId, nodesRef.current, connectionsRef.current) : [];
                    const storedStoryboardAnchorImages = usesWholeStoryboardSheet && sourceNode?.type === CanvasNodeType.Video ? await resolveStoredVideoImageReferences(sourceNode.metadata) : [];
                    const hasReusableStoredStoryboardAnchor = storedStoryboardAnchorImages.length > 0 && (sourceNode?.metadata?.storyboardVideoAnchorMode === "generated-bridge" || sourceNode?.metadata?.storyboardVideoAnchorMode === "keyframe");
                    const storyboardReferenceFrames = usesWholeStoryboardSheet ? [] : await storyboardReviewSheetReferenceFrames(nodeId, nodesRef.current, connectionsRef.current);
                    // A contact sheet is planning material, never a literal I2V frame.
                    // Rebuild one clean anchor whenever original identity/product
                    // references exist, or when no independent keyframe is available.
                    const needsStoryboardBridge = usesWholeStoryboardSheet && !hasReusableStoredStoryboardAnchor && (!storyboardKeyframeAnchorImages.length || storyboardIdentityImages.length > 0);
                    const wholeStoryboardImages = usesWholeStoryboardSheet
                        ? hasReusableStoredStoryboardAnchor
                            ? storedStoryboardAnchorImages.slice(0, 1)
                            : mergeReferenceImages(storyboardKeyframeAnchorImages, storyboardReviewSheetImages).slice(0, 1)
                        : [];
                    const wholeStoryboardAnchorMode = usesWholeStoryboardSheet
                        ? hasReusableStoredStoryboardAnchor
                            ? sourceNode.metadata?.storyboardVideoAnchorMode
                            : needsStoryboardBridge
                              ? ("bridge-pending" as const)
                              : ("keyframe" as const)
                        : undefined;
                    const videoIdentityImages = usesWholeStoryboardSheet ? [] : mergeReferenceImages(generationContext.referenceImages, storyboardIdentityImages);
                    const storyboardVideoImages = usesWholeStoryboardSheet ? wholeStoryboardImages : storyboardReferenceFrames;
                    const allVideoReferenceImages = mergeReferenceImages(videoIdentityImages, storyboardVideoImages);
                    const videoReferenceVideos = usesWholeStoryboardSheet ? [] : generationContext.referenceVideos;
                    const videoReferenceAudios = usesWholeStoryboardSheet ? [] : generationContext.referenceAudios;
                    const baseVideoGenerationConfig = resolveReferenceImageVideoConfig(generationConfig, allVideoReferenceImages.length);
                    let videoReferenceImages = usesWholeStoryboardSheet ? storyboardVideoImages : selectGrokReferenceVideoImagesWithPriority(videoIdentityImages, storyboardVideoImages, baseVideoGenerationConfig.model);
                    let videoPromptSource = effectivePrompt;
                    const directProductLock = buildDirectProductLockVideoContext(videoPromptSource, videoReferenceImages, storyboardVideoImages.length, baseVideoGenerationConfig.model, baseVideoGenerationConfig.videoProductScaleMode);
                    if (directProductLock) {
                        videoReferenceImages = directProductLock.referenceImages;
                        videoPromptSource = directProductLock.prompt;
                    }
                    const videoGenerationConfig = resolveReferenceImageVideoConfig(generationConfig, directProductLock ? 1 : videoReferenceImages.length);
                    const videoIdentityReferenceCount = Math.min(videoIdentityImages.length, videoReferenceImages.length);
                    let storyboardPlan = resolveStoryboardVideoPlan(nodeId, nodesRef.current, connectionsRef.current, videoPromptSource);
                    if (usesWholeStoryboardSheet && storyboardPlan?.beats?.length) {
                        storyboardPlan = repairStoryboardAudioPlanForDuration(storyboardPlan, Number(videoGenerationConfig.videoSeconds));
                    }
                    if (usesWholeStoryboardSheet && !hasCompleteStoryboardAudioPlan(storyboardPlan, Number(videoGenerationConfig.videoSeconds))) {
                        message.info("正在按当前时长恢复分镜语义与自然口播...");
                        storyboardPlan = await recoverLegacyStoryboardVideoPlan(generationConfig, storyboardReviewSheetImages, videoGenerationConfig.videoSeconds, videoPromptSource, storyboardPlan);
                        const reviewNodeIds = new Set(storyboardReviewSheetNodes(nodeId, nodesRef.current, connectionsRef.current).map((item) => item.id));
                        setNodes((prev) =>
                            prev.map((item) =>
                                reviewNodeIds.has(item.id)
                                    ? {
                                          ...item,
                                          metadata: { ...item.metadata, commerceVideoPlan: storyboardPlan || undefined },
                                      }
                                    : item,
                            ),
                        );
                    }
                    if (usesWholeStoryboardSheet && storyboardPlan?.beats?.length) {
                        videoPromptSource = compileVideoPrompt(storyboardPlan, {
                            model: "grok",
                            duration: Number(videoGenerationConfig.videoSeconds),
                            aspectRatio: videoAspectRatioForSize(videoGenerationConfig.size),
                            referenceMode: grokVideoReferenceMode(videoGenerationConfig.model, videoReferenceImages.length),
                        });
                    }
                    if (usesWholeStoryboardSheet && !storyboardPlan?.beats?.length) throw new Error("分镜规划数据不完整，无法生成整片视频");
                    const videoPrompt =
                        usesWholeStoryboardSheet && storyboardPlan
                            ? compileStoryboardCleanAnchorVideoPrompt(storyboardPlan, {
                                  model: "grok",
                                  duration: Number(videoGenerationConfig.videoSeconds),
                                  aspectRatio: videoAspectRatioForSize(videoGenerationConfig.size),
                                  referenceMode: "i2v",
                              })
                            : buildStoryboardReviewSheetVideoPrompt(
                                  videoPromptSource,
                                  storyboardReferenceFrames.length,
                                  videoGenerationConfig.videoSeconds,
                                  videoReferenceImages.length,
                                  videoIdentityReferenceCount,
                                  videoAspectRatioForSize(videoGenerationConfig.size),
                                  storyboardPlan || undefined,
                              );
                    if (!videoPrompt && !videoReferenceImages.length && !videoReferenceVideos.length && !videoReferenceAudios.length) {
                        throw new Error("请输入视频提示词，或连接干净关键帧/参考图后再生成视频");
                    }
                    const spec = nodeSizeFromRatio(videoGenerationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || (usesWholeStoryboardSheet || storyboardVideoImages.length ? "Storyboard Video" : "Generated Video"),
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: videoPrompt,
                            status: NODE_STATUS_LOADING,
                            statusMessage: needsStoryboardBridge || directProductLock ? "正在重建高清首帧..." : "正在提交视频...",
                            model: videoGenerationConfig.model,
                            size: videoGenerationConfig.size,
                            seconds: videoGenerationConfig.videoSeconds,
                            vquality: videoGenerationConfig.vquality,
                            productScaleMode: videoGenerationConfig.videoProductScaleMode,
                            generateAudio: videoGenerationConfig.videoGenerateAudio,
                            watermark: videoGenerationConfig.videoWatermark,
                            videoSourcePrompt: videoPromptSource,
                            videoConstraintVersion: usesWholeStoryboardSheet || storyboardVideoImages.length ? GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION : undefined,
                            videoReferenceImages: generationImageReferenceUrls(videoReferenceImages),
                            storyboardVideoAnchorMode: wholeStoryboardAnchorMode,
                            commerceVideoPlan: usesWholeStoryboardSheet ? storyboardPlan || undefined : undefined,
                            references: generationReferenceUrls({ referenceImages: videoReferenceImages, referenceVideos: videoReferenceVideos, referenceAudios: videoReferenceAudios }),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isEmptyVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    const updateVideoGenerationStage = (statusMessage: string) => {
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, metadata: { ...node.metadata, statusMessage } } : node)));
                    };
                    try {
                        let requestVideoPrompt = videoPrompt;
                        let requestVideoReferenceImages = videoReferenceImages;
                        if (needsStoryboardBridge && storyboardPlan) {
                            const bridgeImage = await createStoryboardVideoBridgeReference(
                                buildGenerationConfig(effectiveConfig, sourceNode, "image"),
                                {
                                    openingCandidate: storyboardKeyframeAnchorImages[0],
                                    identityReferences: storyboardIdentityImages,
                                    storyboardReference: storyboardReviewSheetImages[0],
                                    plan: storyboardPlan,
                                    productScaleMode: videoGenerationConfig.videoProductScaleMode,
                                },
                                videoGenerationConfig.size,
                                controller.signal,
                                updateVideoGenerationStage,
                            );
                            requestVideoReferenceImages = [bridgeImage];
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === videoId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  prompt: requestVideoPrompt,
                                                  videoReferenceImages: generationImageReferenceUrls(requestVideoReferenceImages),
                                                  storyboardVideoAnchorMode: "generated-bridge",
                                                  references: generationReferenceUrls({ referenceImages: requestVideoReferenceImages, referenceVideos: videoReferenceVideos, referenceAudios: videoReferenceAudios }),
                                              },
                                          }
                                        : node,
                                ),
                            );
                        } else if (directProductLock) {
                            const bridgeImage = await createDirectProductBridgeReference(buildGenerationConfig(effectiveConfig, sourceNode, "image"), directProductLock, videoGenerationConfig.size, controller.signal, updateVideoGenerationStage);
                            requestVideoReferenceImages = [bridgeImage];
                            requestVideoPrompt = buildStoryboardReviewSheetVideoPrompt(
                                directProductLock.videoPrompt,
                                storyboardReferenceFrames.length,
                                videoGenerationConfig.videoSeconds,
                                requestVideoReferenceImages.length,
                                0,
                                videoAspectRatioForSize(videoGenerationConfig.size),
                                storyboardPlan || undefined,
                            );
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === videoId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  prompt: requestVideoPrompt,
                                                  videoReferenceImages: generationImageReferenceUrls(requestVideoReferenceImages),
                                                  references: generationReferenceUrls({ referenceImages: requestVideoReferenceImages, referenceVideos: videoReferenceVideos, referenceAudios: videoReferenceAudios }),
                                              },
                                          }
                                        : node,
                                ),
                            );
                        }
                        updateVideoGenerationStage("视频任务提交/生成中...");
                        const video = await storeGeneratedVideo(await requestVideoGeneration(videoGenerationConfig, requestVideoPrompt, requestVideoReferenceImages, videoReferenceVideos, videoReferenceAudios, { signal: controller.signal }));
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...node.metadata,
                                              ...videoMetadata(video),
                                              prompt: requestVideoPrompt,
                                              model: videoGenerationConfig.model,
                                              size: videoGenerationConfig.size,
                                              seconds: videoGenerationConfig.videoSeconds,
                                              vquality: videoGenerationConfig.vquality,
                                              productScaleMode: videoGenerationConfig.videoProductScaleMode,
                                              generateAudio: videoGenerationConfig.videoGenerateAudio,
                                              watermark: videoGenerationConfig.videoWatermark,
                                              statusMessage: undefined,
                                              storyboardVideoAnchorMode:
                                                  usesWholeStoryboardSheet && wholeStoryboardAnchorMode === "bridge-pending" ? "generated-bridge" : usesWholeStoryboardSheet ? wholeStoryboardAnchorMode : node.metadata?.storyboardVideoAnchorMode,
                                              videoReferenceImages: generationImageReferenceUrls(requestVideoReferenceImages),
                                              references: generationReferenceUrls({ referenceImages: requestVideoReferenceImages, referenceVideos: videoReferenceVideos, referenceAudios: videoReferenceAudios }),
                                          },
                                      }
                                    : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14 },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        let localStreamed = "";
                        return requestImageQuestion(
                            generationConfig,
                            buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                            (text) => {
                                localStreamed = text;
                                streamed = text;
                                if (isConfigNode) return;
                                setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                            },
                            { signal: controller.signal },
                        )
                            .then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed }))
                            .finally(() => finishGenerationRequest(targetNodeId, controller));
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                                : node,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, statusMessage: undefined, errorDetails } }) : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [confirmFusionPlacementPlan, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            if (generationRequestsRef.current.has(node.id)) {
                message.warning("该任务正在重试，请勿重复提交");
                return;
            }
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            let generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.editRequestSize || savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const savedVideoDirection = node.type === CanvasNodeType.Video ? node.metadata?.videoSourcePrompt || unwrapStoryboardVideoUserDirection(node.metadata?.prompt || "") || "" : "";
            const retryBasePrompt = node.type === CanvasNodeType.Video ? savedVideoDirection || sourceNode.metadata?.prompt || "" : sourceNode.metadata?.prompt || node.metadata?.prompt || "";
            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, retryBasePrompt));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            const storyboardRetryWholeImages = node.type === CanvasNodeType.Video ? storyboardReviewSheetWholeReferences(sourceNode.id, nodesRef.current, connectionsRef.current) : [];
            const retriesWholeStoryboardSheet = storyboardRetryWholeImages.length > 0 || isStoredWholeStoryboardVideo(node);
            const retryReferenceVideos = retriesWholeStoryboardSheet ? [] : context?.referenceVideos || [];
            const retryReferenceAudios = retriesWholeStoryboardSheet ? [] : context?.referenceAudios || [];
            const storedVideoReferenceImages = node.type === CanvasNodeType.Video ? await resolveStoredVideoImageReferences(node.metadata) : [];
            const storyboardRetryIdentityImages = node.type === CanvasNodeType.Video ? await storyboardReviewSheetIdentityReferences(sourceNode.id, nodesRef.current, connectionsRef.current) : [];
            const storyboardRetryKeyframeImages = node.type === CanvasNodeType.Video && retriesWholeStoryboardSheet ? storyboardReviewSheetKeyframeAnchorReferences(sourceNode.id, nodesRef.current, connectionsRef.current) : [];
            const hasReusableStoredStoryboardAnchor = retriesWholeStoryboardSheet && storedVideoReferenceImages.length > 0 && (node.metadata?.storyboardVideoAnchorMode === "generated-bridge" || node.metadata?.storyboardVideoAnchorMode === "keyframe");
            const needsRetryStoryboardBridge = retriesWholeStoryboardSheet && !hasReusableStoredStoryboardAnchor && (!storyboardRetryKeyframeImages.length || storyboardRetryIdentityImages.length > 0);
            const storyboardRetryImages = node.type === CanvasNodeType.Video && !retriesWholeStoryboardSheet ? await storyboardReviewSheetReferenceFrames(sourceNode.id, nodesRef.current, connectionsRef.current) : [];
            const hasVideoReferences =
                node.type === CanvasNodeType.Video &&
                Boolean(storyboardRetryWholeImages.length || storedVideoReferenceImages.length || storyboardRetryImages.length || context?.referenceImages.length || retryReferenceVideos.length || retryReferenceAudios.length);
            if (!prompt && !hasVideoReferences) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retrySourceImages = hasSavedImageMetadata ? [] : sourceNodeReferenceImages(sourceNode);
            const retryWholeStoryboardAnchors = retriesWholeStoryboardSheet ? (hasReusableStoredStoryboardAnchor ? storedVideoReferenceImages.slice(0, 1) : mergeReferenceImages(storyboardRetryKeyframeImages, storyboardRetryWholeImages).slice(0, 1)) : [];
            if (retriesWholeStoryboardSheet && !retryWholeStoryboardAnchors.length) {
                const errorDetails = "找不到原始12宫格分镜图，无法重试整片视频";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                return;
            }
            let retryWholeStoryboardAnchorMode = retriesWholeStoryboardSheet ? (hasReusableStoredStoryboardAnchor ? node.metadata?.storyboardVideoAnchorMode : needsRetryStoryboardBridge ? ("bridge-pending" as const) : ("keyframe" as const)) : undefined;
            const retryIdentityImages = retriesWholeStoryboardSheet ? [] : mergeReferenceImages(storyboardRetryIdentityImages, storedVideoReferenceImages, retrySourceImages, retryReferenceImages || []);
            const retryImages =
                node.type === CanvasNodeType.Video
                    ? retriesWholeStoryboardSheet
                        ? retryWholeStoryboardAnchors
                        : mergeReferenceImages(retryIdentityImages, storyboardRetryImages)
                    : mergeReferenceImages(retrySourceImages, retryReferenceImages || [], storyboardRetryImages);
            let retryVideoImages = retryImages;
            let retryVideoPromptSource = prompt;
            let retryStoryboardPlan = node.type === CanvasNodeType.Video ? resolveStoryboardVideoPlan(sourceNode.id, nodesRef.current, connectionsRef.current, retryVideoPromptSource) : null;
            let retryDirectProductLock: ReturnType<typeof buildDirectProductLockVideoContext> = null;
            if (node.type === CanvasNodeType.Video) {
                const retryOriginalGenerationConfig = generationConfig;
                generationConfig = resolveReferenceImageVideoConfig(retryOriginalGenerationConfig, retryImages.length);
                retryVideoImages = retriesWholeStoryboardSheet ? retryWholeStoryboardAnchors : selectGrokReferenceVideoImagesWithPriority(retryIdentityImages, storyboardRetryImages, generationConfig.model);
                retryDirectProductLock = buildDirectProductLockVideoContext(retryVideoPromptSource, retryVideoImages, storyboardRetryImages.length, generationConfig.model, generationConfig.videoProductScaleMode);
                if (retryDirectProductLock) {
                    retryVideoImages = retryDirectProductLock.referenceImages;
                    retryVideoPromptSource = retryDirectProductLock.prompt;
                }
                generationConfig = resolveReferenceImageVideoConfig(retryOriginalGenerationConfig, retryDirectProductLock ? 1 : retryVideoImages.length);
            }
            const retryPrompt = savedImageMetadata?.productDetailShot
                ? prompt
                : savedImageMetadata?.fusionPlacementPlanV1
                  ? buildSceneAwareImageEditPrompt(savedImageMetadata.fusionPlacementPlanV1, prompt)
                  : buildIdentityPreservingImageEditPrompt(prompt, retrySourceImages.length > 0 || Boolean(hasSavedImageMetadata && retryImages.length), retryImages);
            const retryMask = savedImageMetadata?.editMask ? await resolveMetadataEditMask(savedImageMetadata.editMask) : undefined;
            if (savedImageMetadata?.editMask && !retryMask) {
                message.error("局部修改蒙版已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "局部修改蒙版已丢失，无法继续重试" } } : item)));
                return;
            }
            let requestImages = retryImages;
            let requestMask = retryMask;
            let retryMaskCrop: Awaited<ReturnType<typeof prepareMaskedEditCropDataUrls>> | undefined;
            let retrySourceDataUrl = "";
            let retryMaskDataUrl = "";
            if (retryMask && retryImages[0]) {
                retrySourceDataUrl = await imageToDataUrl(retryImages[0]);
                retryMaskDataUrl = await imageToDataUrl(retryMask);
                retryMaskCrop = await prepareMaskedEditCropDataUrls(retrySourceDataUrl, retryMaskDataUrl);
                generationConfig = { ...generationConfig, size: resolveMaskEditRequestSizeFromDimensions(retryMaskCrop.width, retryMaskCrop.height) };
                requestImages = [{ ...retryImages[0], name: `${retryImages[0].name || retryImages[0].id || "image"}-edit-region.png`, dataUrl: retryMaskCrop.sourceDataUrl, storageKey: undefined }];
                requestMask = { ...retryMask, dataUrl: retryMaskCrop.maskDataUrl, storageKey: undefined };
            }

            setRunningNodeId(node.id);
            setNodes((prev) =>
                prev.map((item) =>
                    item.id === node.id
                        ? {
                              ...item,
                              metadata: {
                                  ...item.metadata,
                                  status: NODE_STATUS_LOADING,
                                  statusMessage: node.type === CanvasNodeType.Video ? (needsRetryStoryboardBridge || retryDirectProductLock ? "正在重建高清首帧..." : "正在提交视频...") : undefined,
                                  errorDetails: undefined,
                              },
                          }
                        : item,
                ),
            );
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);
            const updateRetryVideoGenerationStage = (statusMessage: string) => {
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, statusMessage } } : item)));
            };

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: controller.signal },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    if (!generationConfig.videoModels.length) throw new Error("当前令牌未开放视频模型");
                    if (retriesWholeStoryboardSheet && retryStoryboardPlan?.beats?.length) {
                        retryStoryboardPlan = repairStoryboardAudioPlanForDuration(retryStoryboardPlan, Number(generationConfig.videoSeconds));
                    }
                    if (retriesWholeStoryboardSheet && !hasCompleteStoryboardAudioPlan(retryStoryboardPlan, Number(generationConfig.videoSeconds))) {
                        updateRetryVideoGenerationStage("按当前时长恢复分镜语义与自然口播...");
                        retryStoryboardPlan = await recoverLegacyStoryboardVideoPlan(generationConfig, storyboardRetryWholeImages, generationConfig.videoSeconds, retryVideoPromptSource, retryStoryboardPlan);
                        const reviewNodeIds = new Set(storyboardReviewSheetNodes(sourceNode.id, nodesRef.current, connectionsRef.current).map((item) => item.id));
                        setNodes((prev) =>
                            prev.map((item) =>
                                item.id === node.id || reviewNodeIds.has(item.id)
                                    ? {
                                          ...item,
                                          metadata: { ...item.metadata, commerceVideoPlan: retryStoryboardPlan || undefined },
                                      }
                                    : item,
                            ),
                        );
                    }
                    if (retriesWholeStoryboardSheet && retryStoryboardPlan?.beats?.length) {
                        retryVideoPromptSource = compileVideoPrompt(retryStoryboardPlan, {
                            model: "grok",
                            duration: Number(generationConfig.videoSeconds),
                            aspectRatio: videoAspectRatioForSize(generationConfig.size),
                            referenceMode: grokVideoReferenceMode(generationConfig.model, retryVideoImages.length),
                        });
                    }
                    if (retriesWholeStoryboardSheet && !retryStoryboardPlan?.beats?.length) throw new Error("分镜规划数据不完整，无法重试整片视频");
                    const retryIdentityReferenceCount = retriesWholeStoryboardSheet ? 0 : Math.min(retryIdentityImages.length, retryVideoImages.length);
                    let videoPrompt =
                        retriesWholeStoryboardSheet && retryStoryboardPlan
                            ? compileStoryboardCleanAnchorVideoPrompt(retryStoryboardPlan, {
                                  model: "grok",
                                  duration: Number(generationConfig.videoSeconds),
                                  aspectRatio: videoAspectRatioForSize(generationConfig.size),
                                  referenceMode: "i2v",
                              })
                            : buildStoryboardReviewSheetVideoPrompt(
                                  retryVideoPromptSource,
                                  storyboardRetryImages.length,
                                  generationConfig.videoSeconds,
                                  retryVideoImages.length,
                                  retryIdentityReferenceCount,
                                  videoAspectRatioForSize(generationConfig.size),
                                  retryStoryboardPlan || undefined,
                              );
                    if (needsRetryStoryboardBridge && retryStoryboardPlan) {
                        const bridgeImage = await createStoryboardVideoBridgeReference(
                            buildGenerationConfig(effectiveConfig, sourceNode, "image"),
                            {
                                openingCandidate: storyboardRetryKeyframeImages[0],
                                identityReferences: storyboardRetryIdentityImages,
                                storyboardReference: storyboardRetryWholeImages[0],
                                plan: retryStoryboardPlan,
                                productScaleMode: generationConfig.videoProductScaleMode,
                            },
                            generationConfig.size,
                            controller.signal,
                            updateRetryVideoGenerationStage,
                        );
                        retryVideoImages = [bridgeImage];
                        retryWholeStoryboardAnchorMode = "generated-bridge";
                        setNodes((prev) =>
                            prev.map((item) =>
                                item.id === node.id
                                    ? {
                                          ...item,
                                          metadata: {
                                              ...item.metadata,
                                              prompt: videoPrompt,
                                              videoReferenceImages: generationImageReferenceUrls(retryVideoImages),
                                              storyboardVideoAnchorMode: retryWholeStoryboardAnchorMode,
                                              references: generationReferenceUrls({ referenceImages: retryVideoImages, referenceVideos: retryReferenceVideos, referenceAudios: retryReferenceAudios }),
                                          },
                                      }
                                    : item,
                            ),
                        );
                    } else if (retryDirectProductLock) {
                        const bridgeImage = await createDirectProductBridgeReference(buildGenerationConfig(effectiveConfig, sourceNode, "image"), retryDirectProductLock, generationConfig.size, controller.signal, updateRetryVideoGenerationStage);
                        retryVideoImages = [bridgeImage];
                        videoPrompt = buildStoryboardReviewSheetVideoPrompt(
                            retryDirectProductLock.videoPrompt,
                            storyboardRetryImages.length,
                            generationConfig.videoSeconds,
                            retryVideoImages.length,
                            0,
                            videoAspectRatioForSize(generationConfig.size),
                            retryStoryboardPlan || undefined,
                        );
                    }
                    updateRetryVideoGenerationStage("视频任务提交/生成中...");
                    const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, videoPrompt, retryVideoImages, retryReferenceVideos, retryReferenceAudios, { signal: controller.signal }));
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      width: videoSize.width,
                                      height: videoSize.height,
                                      position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
                                      metadata: {
                                          ...item.metadata,
                                          ...videoMetadata(video),
                                          prompt: videoPrompt,
                                          model: generationConfig.model,
                                          size: generationConfig.size,
                                          seconds: generationConfig.videoSeconds,
                                          vquality: generationConfig.vquality,
                                          productScaleMode: generationConfig.videoProductScaleMode,
                                          generateAudio: generationConfig.videoGenerateAudio,
                                          watermark: generationConfig.videoWatermark,
                                          statusMessage: undefined,
                                          videoSourcePrompt: retryVideoPromptSource,
                                          commerceVideoPlan: retryStoryboardPlan || item.metadata?.commerceVideoPlan,
                                          videoConstraintVersion: retriesWholeStoryboardSheet || storyboardRetryImages.length ? GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION : undefined,
                                          videoReferenceImages: generationImageReferenceUrls(retryVideoImages).length ? generationImageReferenceUrls(retryVideoImages) : item.metadata?.videoReferenceImages,
                                          storyboardVideoAnchorMode: retryWholeStoryboardAnchorMode,
                                          references: generationReferenceUrls({ referenceImages: retryVideoImages, referenceVideos: retryReferenceVideos, referenceAudios: retryReferenceAudios }),
                                      },
                                  }
                                : item,
                        ),
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, retryPrompt, requestImages, requestMask, { signal: controller.signal }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const finalDataUrl =
                    retryMaskCrop && retrySourceDataUrl && retryMaskDataUrl
                        ? await applyMaskedEditCropDataUrl(retrySourceDataUrl, image.dataUrl, retryMaskDataUrl, retryMaskCrop)
                        : retryMask && retryImages[0]
                          ? await applyMaskedEditDataUrl(await imageToDataUrl(retryImages[0]), image.dataUrl, await imageToDataUrl(retryMask))
                          : image.dataUrl;
                const uploadedImage = await uploadImage(finalDataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: savedImageMetadata.size || generationConfig.size,
                          quality: generationConfig.quality,
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                          editMask: savedImageMetadata.editMask,
                          editRequestSize: savedImageMetadata.editRequestSize,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  width: imageSize.width,
                                  height: imageSize.height,
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, statusMessage: undefined, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const taskSummary = useMemo(() => {
        const loadingNodes = nodes.filter((node) => node.metadata?.status === NODE_STATUS_LOADING);
        const failedNodes = nodes.filter((node) => node.metadata?.status === NODE_STATUS_ERROR);
        const firstLoading = loadingNodes[0];
        const firstFailed = failedNodes[0];
        return {
            loadingCount: loadingNodes.length,
            loadingLabel: firstLoading?.metadata?.statusMessage || (firstLoading ? `${canvasNodeTypeLabel(firstLoading.type)}生成中` : ""),
            failedCount: failedNodes.length,
            failedLabel: firstFailed?.title || (firstFailed ? `${canvasNodeTypeLabel(firstFailed.type)}任务失败` : ""),
        };
    }, [nodes]);

    const focusFirstFailedNode = useCallback(() => {
        const failedNode = nodesRef.current.find((node) => node.metadata?.status === NODE_STATUS_ERROR);
        if (!failedNode) return;
        focusNodesInViewport([failedNode]);
        setSelectedNodeIds(new Set([failedNode.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(failedNode.id);
    }, [focusNodesInViewport]);

    const retryFailedNodes = useCallback(() => {
        const failedNodes = nodesRef.current.filter((node) => node.metadata?.status === NODE_STATUS_ERROR);
        if (!failedNodes.length) return;
        const retryNodes = failedNodes.slice(0, 6);
        retryNodes.forEach((node) => void handleRetryNode(node));
        if (failedNodes.length > retryNodes.length) message.info(`已重试前 ${retryNodes.length} 个失败节点，剩余节点请稍后再重试。`);
    }, [handleRetryNode, message]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            const storyboardPlan = node.metadata?.commerceVideoPlan?.beats?.length ? node.metadata.commerceVideoPlan : extractCommerceVideoPlan(prompt);
            if (storyboardPlan?.beats?.length) {
                void handleGenerateVideoStoryboard(node.id, storyboardPlan).catch((error) => {
                    message.error(`12宫格分镜候选生成失败：${error instanceof Error ? error.message : "未知错误"}`);
                });
                return;
            }
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, handleGenerateVideoStoryboard, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const assistantOpen = assistantMounted && !assistantCollapsed;
    const openAgent = (mode: CanvasAgentMode = agentMode) => {
        if (agentCloseTimerRef.current) {
            clearTimeout(agentCloseTimerRef.current);
            agentCloseTimerRef.current = null;
        }
        setAgentMode(mode);
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    };
    const closeAgent = () => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        agentCloseTimerRef.current = setTimeout(() => {
            agentCloseTimerRef.current = null;
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    };

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => router.push("/")}
                    onProjects={() => router.push("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={assistantOpen}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDoubleClick={handleCanvasDoubleClick}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            renderPanel={(panelNode) =>
                                panelNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigComposer
                                        value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                                        inputs={configInputsById.get(panelNode.id) || []}
                                        onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                                        onClose={() => setDialogNodeId(null)}
                                    />
                                ) : panelNode.type === CanvasNodeType.Director ? (
                                    <CanvasDirectorPanel node={panelNode} onOpen={(targetNode) => setDirectorStudioNodeId(targetNode.id)} />
                                ) : (
                                    <CanvasNodePromptPanel
                                        node={panelNode}
                                        isRunning={runningNodeId === panelNode.id}
                                        mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || []}
                                        onPromptChange={handleNodePromptChange}
                                        onConfigChange={handleConfigNodeChange}
                                        onGenerate={handleGenerateNode}
                                        onGenerateProductBreakdown={handleGenerateProductBreakdown}
                                        onGenerateSceneExpansion={handleGenerateSceneExpansion}
                                        onGenerateVideoStoryboard={handleGenerateVideoStoryboard}
                                        onStop={confirmStopGeneration}
                                        onImageSettingsOpenChange={(open) => {
                                            setNodeImageSettingsOpen(open);
                                            if (open) setToolbarNodeId(null);
                                        }}
                                    />
                                )
                            }
                            renderNodeContent={(contentNode) =>
                                contentNode.type === CanvasNodeType.Director ? (
                                    <CanvasDirectorNode node={contentNode} onOpen={(targetNode) => setDirectorStudioNodeId(targetNode.id)} />
                                ) : contentNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigNodePanel
                                        node={contentNode}
                                        isRunning={runningNodeId === contentNode.id}
                                        inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                                        onConfigChange={handleConfigNodeChange}
                                        onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                                        onStop={confirmStopGeneration}
                                        onGenerate={(nodeId) => {
                                            const target = nodesRef.current.find((item) => item.id === nodeId);
                                            void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                                        }}
                                    />
                                ) : null
                            }
                            onMouseDown={handleNodeMouseDown}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                                keepNodeToolbar(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                                hideNodeToolbar();
                            }}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onContentChange={handleNodeContentChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node) => void handleRetryNode(node)}
                            onGenerateImage={generateImageFromTextNode}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onContextMenu={(event, id) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
                            }}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} hasVideo={hasVideoModels} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                </InfiniteCanvas>

                {projectLoaded && !nodes.length ? (
                    <CanvasEmptyGuide theme={theme} onCreateText={() => createTextNodeAt(getCanvasCenter())} onCreateImage={() => createNode(CanvasNodeType.Image)} onUpload={() => handleUploadRequest(undefined, getCanvasCenter())} />
                ) : null}

                <CanvasActivityStatus
                    theme={theme}
                    saveStatus={saveStatus}
                    lastSavedAt={lastSavedAt}
                    saveError={saveError}
                    loadingCount={taskSummary.loadingCount}
                    loadingLabel={taskSummary.loadingLabel}
                    failedCount={taskSummary.failedCount}
                    failedLabel={taskSummary.failedLabel}
                    onFocusFailed={focusFirstFailedNode}
                    onRetryFailed={retryFailedNodes}
                />

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onGenerateStoryboardKeyframes={(node) => void handleGenerateStoryboardKeyframes(node)}
                    onGenerateFullVideo={(node) => void handleGenerateNode(node.id, "video", node.metadata?.prompt || "")}
                    onGenerateVideoClips={(node) => void handleGenerateVideoClips(node)}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onReverseVideoPrompt={(node) => void createVideoReversePromptNodes(node)}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    hasVideo={hasVideoModels}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddDirector={() => createNode(CanvasNodeType.Director)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                {directorStudioNode ? <DirectorStudioDialog open={Boolean(directorStudioNode)} onClose={() => setDirectorStudioNodeId(null)} onSnapshot={(payload) => createDirectorSnapshotNodes(directorStudioNode, payload)} /> : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? <img src={previewNode.metadata.content} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
            {assistantMounted ? (
                <CanvasAssistantPanel
                    nodes={nodes}
                    selectedNodeIds={selectedNodeIds}
                    snapshot={agentSnapshot}
                    sessions={chatSessions}
                    activeSessionId={activeChatId}
                    onSelectNodeIds={setSelectedNodeIds}
                    onSessionsChange={handleAssistantSessionsChange}
                    onApplyOps={applyAgentOps}
                    canUndoOps={Boolean(agentUndoSnapshot)}
                    onUndoOps={undoAgentOps}
                    onPasteImage={pasteAssistantImage}
                    agentMode={agentMode}
                    onAgentModeChange={setAgentMode}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                />
            ) : null}
        </main>
    );
}

function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    agentOpen,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "文档", onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <BrandMark className="[&>img]:size-6" />
                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function CanvasActivityStatus({
    theme,
    saveStatus,
    lastSavedAt,
    saveError,
    loadingCount,
    loadingLabel,
    failedCount,
    failedLabel,
    onFocusFailed,
    onRetryFailed,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    saveStatus: "idle" | "saving" | "saved" | "error";
    lastSavedAt: number | null;
    saveError?: string;
    loadingCount: number;
    loadingLabel: string;
    failedCount: number;
    failedLabel: string;
    onFocusFailed: () => void;
    onRetryFailed: () => void;
}) {
    const showSave = saveStatus !== "idle" || Boolean(lastSavedAt);
    if (!showSave && !loadingCount && !failedCount) return null;

    const saveMeta =
        saveStatus === "saving"
            ? { icon: <Loader2 className="size-3.5 animate-spin" />, text: "保存中", tone: "text-sky-500" }
            : saveStatus === "error"
              ? { icon: <AlertCircle className="size-3.5" />, text: "保存失败", tone: "text-red-500" }
              : { icon: <CheckCircle2 className="size-3.5" />, text: lastSavedAt ? `已保存 ${formatCanvasSaveTime(lastSavedAt)}` : "已保存", tone: "text-emerald-500" };

    return (
        <div className="pointer-events-auto absolute left-4 top-20 z-40 flex max-w-[min(560px,calc(100vw-32px))] flex-wrap items-center gap-2">
            {showSave ? (
                <div
                    className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium shadow-lg backdrop-blur-md ${saveMeta.tone}`}
                    style={{ background: `${theme.toolbar.panel}e8`, borderColor: theme.toolbar.border }}
                    title={saveError || undefined}
                >
                    {saveMeta.icon}
                    <span>{saveMeta.text}</span>
                </div>
            ) : null}
            {loadingCount ? (
                <div className="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium text-sky-500 shadow-lg backdrop-blur-md" style={{ background: `${theme.toolbar.panel}e8`, borderColor: theme.toolbar.border }}>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>{loadingCount > 1 ? `${loadingCount} 个任务生成中` : loadingLabel || "生成中"}</span>
                </div>
            ) : null}
            {failedCount ? (
                <div className="inline-flex min-h-9 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium text-red-500 shadow-lg backdrop-blur-md" style={{ background: `${theme.toolbar.panel}ee`, borderColor: "rgba(248,113,113,.45)" }}>
                    <XCircle className="size-3.5 shrink-0" />
                    <span className="max-w-[220px] truncate">{failedCount > 1 ? `${failedCount} 个任务失败` : failedLabel || "任务失败"}</span>
                    <button type="button" className="rounded-full px-2 py-1 transition hover:bg-current/10" onClick={onFocusFailed}>
                        查看
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-current/10" onClick={onRetryFailed}>
                        <RotateCcw className="size-3" />
                        重试
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

function fusionPlacementPlannerErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const detail = raw.trim();
    const lower = detail.toLowerCase();
    if (/524|timeout|timed out|超时/.test(lower)) return "场景摆放规划超时，已停止融合。请稍后重试，或先减少参考产品图。";
    if (/429|too many|rate|限流|频率/.test(lower)) return "场景摆放规划请求过多，已停止融合。请稍后重试。";
    if (/401|403|unauthorized|forbidden|api key|令牌|权限/.test(lower)) return "当前令牌无法完成场景摆放规划，已停止融合。请检查模型权限后重试。";
    if (/json|schema|parse|格式/.test(lower)) return "场景摆放规划返回格式异常，已停止融合。请重试一次。";
    return detail ? `场景摆放规划失败，已停止融合，避免生成错误合成图。原因：${detail.slice(0, 180)}` : "场景摆放规划失败，已停止融合，避免生成错误合成图。";
}

function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

function resolveMaskEditRequestSize(node: CanvasNodeData) {
    const sizeMatch = node.metadata?.size?.match(/^(\d+)x(\d+)$/i);
    const width = node.metadata?.naturalWidth || (sizeMatch ? Number(sizeMatch[1]) : 1024);
    const height = node.metadata?.naturalHeight || (sizeMatch ? Number(sizeMatch[2]) : 1024);
    return resolveMaskEditRequestSizeFromDimensions(width, height);
}

function resolveMaskEditRequestSizeFromDimensions(width: number, height: number) {
    const longEdge = Math.max(width, height);
    const minimumPixelScale = Math.sqrt(655360 / Math.max(1, width * height)) * 1.01;
    const scale = Math.min(2048 / longEdge, Math.max(1, minimumPixelScale));
    return `${alignImageRequestDimension(width * scale)}x${alignImageRequestDimension(height * scale)}`;
}

function alignImageRequestDimension(value: number) {
    return Math.max(16, Math.ceil(value / 16) * 16);
}

function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function referenceFingerprint(image: ReferenceImage) {
    return image.storageKey || image.url || image.id || referenceUrl(image) || image.dataUrl.slice(0, 96);
}

function generationImageReferenceUrls(images: ReferenceImage[]) {
    return images.map(referenceUrl).filter((url): url is string => Boolean(url));
}

function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

async function resolveStoredVideoImageReferences(metadata?: CanvasNodeMetadata): Promise<ReferenceImage[]> {
    const explicitUrls = metadata?.videoReferenceImages || [];
    const urls = explicitUrls.length ? explicitUrls : (metadata?.references || []).filter((url) => url.startsWith("image:"));
    const references = await Promise.all(
        urls.map(async (url, index): Promise<ReferenceImage | null> => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl
                ? {
                      id: `saved-video-reference-${index}`,
                      name: `saved-video-reference-${index + 1}.png`,
                      type: "image/png",
                      dataUrl,
                      storageKey: url.startsWith("image:") ? url : undefined,
                  }
                : null;
        }),
    );
    return references.filter((reference): reference is ReferenceImage => Boolean(reference));
}

async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function resolveMetadataEditMask(url: string): Promise<ReferenceImage | undefined> {
    const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
    if (!dataUrl) return undefined;
    return {
        id: "edit-mask",
        name: "mask.png",
        type: "image/png",
        dataUrl,
        storageKey: url.startsWith("image:") ? url : undefined,
    };
}

function formatCanvasSaveTime(value: number) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function canvasNodeTypeLabel(type: CanvasNodeType) {
    if (type === CanvasNodeType.Image) return "图片";
    if (type === CanvasNodeType.Video) return "视频";
    if (type === CanvasNodeType.Audio) return "音频";
    if (type === CanvasNodeType.Text) return "文本";
    if (type === CanvasNodeType.Director) return "导演台";
    return "配置";
}

function buildDirectorBlueprintImageEditPrompt(prompt: string) {
    return [
        "Create a new finished image using Image 1 only as a director layout blueprint.",
        "Image 1 controls camera angle, subject placement, pose direction, staging depth, prop/table placement, and lighting direction.",
        "Do not preserve Image 1 as locked pixels. Replace all low-poly placeholder geometry, blank face, gray studio, grid floor, UI traces, and simple 3D materials with a polished final image.",
        "Keep the same camera geometry and spatial relationship, but render natural people, real objects, realistic surfaces, and the visual style requested below.",
        "Return only the final generated image.",
        "",
        "USER CREATIVE REQUEST:",
        prompt.trim(),
    ].join("\n");
}

async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type === CanvasNodeType.Director && node.metadata?.directorLastSnapshotStorageKey)
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        directorLastSnapshot: await resolveImageUrl(node.metadata.directorLastSnapshotStorageKey, node.metadata.directorLastSnapshot),
                    },
                };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            for (;;) {
                const index = nextIndex++;
                if (index >= items.length) return;
                await task(items[index], index);
            }
        }),
    );
}

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    const configuredModel = node?.metadata?.model;
    const resolvedModel = configuredModel && modelMatchesCapability(configuredModel, mode) ? configuredModel : defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model);
    const nodeOwnsVideoTiming = node?.type === CanvasNodeType.Video || node?.type === CanvasNodeType.Config;
    const resolvedVideoSeconds = (nodeOwnsVideoTiming ? node?.metadata?.seconds : undefined) || config.videoSeconds || defaultConfig.videoSeconds;
    return {
        ...config,
        model: resolvedModel,
        videoModel: mode === "video" ? resolvedModel : config.videoModel,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        videoSeconds: resolvedVideoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoProductScaleMode: node?.metadata?.productScaleMode || config.videoProductScaleMode || defaultConfig.videoProductScaleMode,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => (node.metadata?.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } } : node));
}

function restoreLegacySceneExpansionBatches(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    let nextNodes = nodes;
    let nextConnections = connections;

    nodes.forEach((analysisNode) => {
        if (analysisNode.type !== CanvasNodeType.Text || !analysisNode.metadata?.sceneExpansion) return;
        const outgoing = connections.filter((connection) => connection.fromNodeId === analysisNode.id);
        const sceneNodes = outgoing
            .map((connection) => nodes.find((node) => node.id === connection.toNodeId))
            .filter((node): node is CanvasNodeData => Boolean(node?.type === CanvasNodeType.Image && node.metadata?.sceneExpansion && !node.metadata?.batchRootId && !node.metadata?.isBatchRoot));
        if (sceneNodes.length < 2) return;

        const [root, ...children] = sceneNodes;
        const childIds = children.map((node) => node.id);
        nextNodes = nextNodes.map((node) => {
            if (node.id === root.id) {
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        isBatchRoot: true,
                        batchChildIds: childIds,
                        batchUsesReferenceImages: true,
                        imageBatchExpanded: true,
                        count: sceneNodes.length,
                    },
                };
            }
            if (childIds.includes(node.id)) return { ...node, metadata: { ...node.metadata, batchRootId: root.id } };
            return node;
        });
        nextConnections = nextConnections.map((connection) => (childIds.includes(connection.toNodeId) && connection.fromNodeId === analysisNode.id ? { ...connection, fromNodeId: root.id } : connection));
    });

    return { nodes: nextNodes, connections: nextConnections };
}

function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

async function storyboardReviewSheetReferenceFrames(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const reviewSheets = storyboardReviewSheetNodes(nodeId, nodes, connections);
    const frameGroups = await Promise.all(reviewSheets.map((item) => splitStoryboardReviewSheetNode(item)));
    return mergeReferenceImages(...frameGroups);
}

function storyboardReviewSheetWholeReferences(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const selectedReview = selectedStoryboardReviewSheetNode(nodeId, nodes, connections);
    return selectedReview ? sourceNodeReferenceImages(selectedReview) : [];
}

function selectedStoryboardReviewSheetNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const direct = nodes.find((item) => item.id === nodeId && isStoryboardReviewSheetNode(item));
    return direct || storyboardReviewSheetNodes(nodeId, nodes, connections)[0];
}

function storyboardReviewSheetNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const node = nodes.find((item) => item.id === nodeId);
    return [...(node && isStoryboardReviewSheetNode(node) ? [node] : []), ...getGenerationResourceNodes(nodeId, nodes, connections).filter(isStoryboardReviewSheetNode)];
}

function storyboardReviewSheetKeyframeAnchorReferences(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const selectedReview = selectedStoryboardReviewSheetNode(nodeId, nodes, connections);
    if (!selectedReview) return [];
    const exactCandidates = nodes
        .filter((item) => item.metadata?.storyboardRole === "keyframe" && item.metadata?.storyboardReviewNodeId === selectedReview.id && item.metadata?.content)
        .sort((a, b) => (a.metadata?.storyboardBeatIndex ?? Number.MAX_SAFE_INTEGER) - (b.metadata?.storyboardBeatIndex ?? Number.MAX_SAFE_INTEGER));
    if (exactCandidates.length) return mergeReferenceImages(...exactCandidates.slice(0, 1).map(sourceNodeReferenceImages));

    const fallbackCandidates = nodes
        .filter(
            (item) =>
                item.metadata?.storyboardRole === "keyframe" &&
                item.metadata?.content &&
                item.metadata?.storyboardPlanId === selectedReview.metadata?.storyboardPlanId &&
                item.metadata?.storyboardReviewIndex === selectedReview.metadata?.storyboardReviewIndex,
        )
        .sort((a, b) => (a.metadata?.storyboardBeatIndex ?? Number.MAX_SAFE_INTEGER) - (b.metadata?.storyboardBeatIndex ?? Number.MAX_SAFE_INTEGER));
    return mergeReferenceImages(...fallbackCandidates.slice(0, 1).map(sourceNodeReferenceImages));
}

async function recoverLegacyStoryboardVideoPlan(config: AiConfig, storyboardImages: ReferenceImage[], videoSeconds: string, sourcePrompt: string, legacyPlan?: CanvasCommerceVideoPlan | null) {
    const [storyboardImage] = storyboardImages;
    if (!storyboardImage) throw new Error("旧分镜缺少完整12宫格，无法恢复镜头语义与口播");
    const dataUrl = await imageToDataUrl(storyboardImage);
    if (!dataUrl) throw new Error("旧分镜图片读取失败，无法恢复镜头语义与口播");

    const unwrappedPrompt = unwrapStoryboardVideoUserDirection(sourcePrompt);
    const savedDirection = normalizeVideoGenerationPrompt(unwrappedPrompt || (sourcePrompt.includes(STORYBOARD_DIRECTED_VIDEO_MARKER) ? "" : sourcePrompt));
    const duration = Math.max(1, Math.floor(Number(videoSeconds) || 15));
    const legacyPlanText = legacyPlan?.beats?.length ? limitInlinePrompt(JSON.stringify(legacyPlan), 7000) : "";
    const recoveryBrief = [
        `Recover one complete ${duration}-second CommerceVideoPlan from the attached complete storyboard contact sheet.`,
        "Read the visible panels from top-left to bottom-right. Preserve their actual people, wardrobe, products, props, environments, action order, and identity; do not import a generic product category or an unrelated action.",
        savedDirection
            ? `Preserve this saved director direction wherever it agrees with the visible panels: ${limitInlinePrompt(savedDirection, 2200)}`
            : "No saved director direction remains. Infer only the story visibly supported by the ordered panels.",
        legacyPlanText ? `Upgrade this legacy plan without dropping its supported beats or constraints: ${legacyPlanText}` : "Create ordered beats that describe the visible panel story precisely.",
        "Unless the saved direction explicitly requests another spoken language, use natural English. Supply audioPlan.scriptsByDuration with independent 6, 10, and 15 second scripts of 8-11, 15-19, and 23-28 English words respectively; audioPlan.script must equal the variant for the requested duration.",
        "Each duration script must sound like one lively real creator speaking naturally, not a director or catalog: start with a short 4-7 word reaction or observation, then one connected benefit or invitation. Use simple easy-to-pronounce everyday words and short clauses, cover most of the video duration, and never write 'from the first ... to the final ...', narrate shot order, list garment geometry, stack feature fragments, or mechanically truncate a longer script.",
        "For a visible adult presenter, use mixed delivery: put the short opening sentence in spokenLine on one stable face-visible medium or close beat, then continue the same voice as off-screen narration over walking, profile, product, detail, or other B-roll. Do not create separate slogans for individual shots or keep the presenter talking through every cut.",
    ].join("\n");
    const result = await polishPrompt(config, recoveryBrief, "video", "storyboard", defaultConfig.textModel || "tokaxis::gpt-5.6-sol", [
        {
            dataUrl,
            label: "complete storyboard contact sheet",
            name: storyboardImage.name || "storyboard-review-sheet.png",
        },
    ]);
    const recovered = extractCommerceVideoPlan(result);
    if (!recovered?.beats?.length) throw new Error("旧分镜语义恢复失败：优化模型没有返回可用的 CommerceVideoPlan");
    const durationScript = storyboardAudioScriptForDuration(recovered, duration);
    const enrichedSource: CanvasCommerceVideoPlan = {
        ...recovered,
        directorBrief: savedDirection || recovered.directorBrief || legacyPlan?.directorBrief,
        audioPlan: recovered.audioPlan
            ? {
                  ...recovered.audioPlan,
                  script: durationScript || recovered.audioPlan.script,
              }
            : undefined,
    };
    const enriched = repairStoryboardAudioPlanForDuration(enrichedSource, duration);
    if (!hasCompleteStoryboardAudioPlan(enriched, duration)) throw new Error("旧分镜语义恢复失败：优化模型没有返回符合当前时长的完整口播脚本");
    return enriched;
}

async function storyboardReviewSheetIdentityReferences(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const reviewSheets = storyboardReviewSheetNodes(nodeId, nodes, connections);
    // Review sheets persist the exact full-size source references used to
    // create them. Restore those first: older canvases may not have a usable
    // storyboardSourceNodeId, while the persisted generation metadata is still
    // intact. Without this fallback Fast receives a small split panel and the
    // presenter/product identity drifts across the generated video.
    const persistedGroups = await Promise.all(
        reviewSheets.map(async (item) => {
            const references = await resolveMetadataReferences(item.metadata || {});
            return references || [];
        }),
    );
    const sourceIds = [...new Set(reviewSheets.map((item) => item.metadata?.storyboardSourceNodeId).filter((id): id is string => Boolean(id)))];
    const sourceGroups = await Promise.all(
        sourceIds.map(async (sourceId) => {
            const sourceNode = nodes.find((item) => item.id === sourceId);
            if (!sourceNode || sourceNode.id === nodeId) return [];
            const sourceContext = await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodes, connections, ""));
            return mergeReferenceImages(sourceNodeReferenceImages(sourceNode), sourceContext.referenceImages);
        }),
    );
    return mergeReferenceImages(...persistedGroups, ...sourceGroups);
}

function isStoryboardReviewSheetNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image && node.metadata?.storyboardRole === "review-sheet";
}

function isStoredWholeStoryboardVideo(node: CanvasNodeData | null | undefined) {
    return node?.type === CanvasNodeType.Video && Boolean(node.metadata?.commerceVideoPlan?.beats?.length) && (node.metadata?.storyboardVideoAnchorMode === "generated-bridge" || node.metadata?.storyboardVideoAnchorMode === "keyframe");
}

async function splitStoryboardReviewSheetNode(node: CanvasNodeData): Promise<ReferenceImage[]> {
    const [reference] = sourceNodeReferenceImages(node);
    if (!reference) return [];
    const dataUrl = await imageToDataUrl(reference);
    if (!dataUrl) return [];
    try {
        const pieces = await splitDataUrl(dataUrl, { rows: STORYBOARD_REVIEW_ROWS, columns: STORYBOARD_REVIEW_COLUMNS });
        return Promise.all(
            pieces.slice(0, STORYBOARD_REVIEW_PANEL_COUNT).map(async (piece, index) => ({
                id: `${reference.id}-storyboard-frame-${index + 1}`,
                name: `${node.title || reference.id}-frame-${String(index + 1).padStart(2, "0")}.png`,
                type: "image/png",
                dataUrl: await cropStoryboardVideoFrame(piece.dataUrl),
            })),
        );
    } catch {
        return [reference];
    }
}

async function cropStoryboardVideoFrame(dataUrl: string) {
    try {
        return await cropDataUrl(dataUrl, STORYBOARD_VIDEO_FRAME_CROP);
    } catch {
        return dataUrl;
    }
}

function buildStoryboardReviewSheetVideoPrompt(
    prompt: string,
    storyboardReferenceCount: number,
    videoSeconds = "15",
    attachedReferenceCount = storyboardReferenceCount,
    identityReferenceCount = 0,
    aspectRatio: "9:16" | "16:9" | "1:1" = "9:16",
    plan?: CanvasCommerceVideoPlan,
) {
    const unwrappedPrompt = unwrapStoryboardVideoUserDirection(prompt);
    const text = normalizeVideoGenerationPrompt(unwrappedPrompt || (prompt.includes("STORYBOARD-DIRECTED VIDEO.") ? "" : prompt));
    if (!storyboardReferenceCount) return text;
    const duration = normalizeStoryboardVideoSeconds(videoSeconds, Math.max(1, attachedReferenceCount));
    return buildStoryboardVideoConstraintPrompt({
        userDirection: compactStoryboardVideoPrompt(text, duration),
        duration,
        sourcePanelCount: STORYBOARD_REVIEW_PANEL_COUNT,
        attachedReferenceCount,
        identityReferenceCount,
        aspectRatio,
        audioDirection: compileStoryboardAudioDirection(plan, text, duration),
    });
}

function compactStoryboardVideoPrompt(prompt: string, duration = 15, maxChars = 900) {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    if (!normalized) return `Create a ${duration}-second reference-led video using only the supplied subject, scene, and ordered actions.`;
    return limitInlinePrompt(normalized, maxChars);
}

function normalizeStoryboardVideoSeconds(value: string, referenceCount: number) {
    return Math.max(1, Math.floor(Number(value) || 15));
}

function normalizeVideoGenerationPrompt(prompt: string) {
    const versionPrompt = extractVideoPromptVersion(prompt);
    return limitVideoPromptLength(sanitizeVideoProviderPrompt(stripStoryboardSheetPrompt(versionPrompt || prompt)))
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function extractVideoPromptVersion(prompt: string) {
    return extractPromptSection(prompt, "Grok Version");
}

function extractPromptSection(prompt: string, heading: string) {
    const pattern = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\nCreate ONE strict (?:\\d+|twelve)-frame storyboard contact sheet|\\nHidden sequence plan:\\s*|\\nRules:\\s*|\\nThe supplied (?:numbered )?storyboard grid|$)`, "i");
    return prompt.match(pattern)?.[1]?.trim() || "";
}

function stripStoryboardSheetPrompt(prompt: string) {
    const markers = [
        "\nCreate ONE strict 12-frame storyboard contact sheet",
        "\nCreate ONE strict twelve-frame storyboard contact sheet",
        "\nPanel plan:",
        "\nHidden sequence plan:",
        "\nRules:\n- Preserve one consistent product identity",
        "\nThe supplied numbered storyboard grid is mandatory shot-order guidance",
        "\nThe supplied storyboard grid is mandatory shot-order guidance",
    ];
    const firstMarker = markers
        .map((marker) => prompt.indexOf(marker))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
    const text = firstMarker === undefined ? prompt : prompt.slice(0, firstMarker);
    return text.replace(/\n?Output a single vertical (?:12|twelve)-panel storyboard sheet\.[\s\S]*$/i, "");
}

function sanitizeVideoProviderPrompt(prompt: string) {
    return prompt
        .replace(/Negative prompt:[\s\S]*$/i, "")
        .replace(/^\s*User prompt:\s*/gim, "")
        .replace(/^\s*User direction:\s*/gim, "")
        .replace(/^The supplied reference image\(s\)[^\n]*\n?/gim, "")
        .replace(/^Preserve the same subject identity[^\n]*\n?/gim, "")
        .replace(/^Perform only the requested[^\n]*\n?/gim, "")
        .replace(/^If a reference is a storyboard sheet[^\n]*\n?/gim, "")
        .replace(/\bgas\s+(?:stovetop|stove|burner)\b/gi, "kitchen cooktop")
        .replace(/\bopen flame\b/gi, "hot cooking surface")
        .replace(/\bactive burner\b/gi, "cooktop surface")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function limitVideoPromptLength(prompt: string) {
    const maxLength = 2400;
    if (prompt.length <= maxLength) return prompt;
    const clipped = prompt.slice(0, maxLength);
    const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("。"), clipped.lastIndexOf("\n"));
    return clipped.slice(0, sentenceEnd > 800 ? sentenceEnd : maxLength).trim();
}

function limitInlinePrompt(value: string, maxChars: number) {
    if (value.length <= maxChars) return value;
    if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
    if (maxChars <= 32) return `${value.slice(0, maxChars - 3).trim()}...`;
    return `${value.slice(0, maxChars - 32).trim()}...`;
}

function buildDirectProductLockVideoContext(prompt: string, referenceImages: ReferenceImage[], storyboardReferenceCount: number, model: string, productScaleMode = "auto") {
    if (storyboardReferenceCount > 0 || referenceImages.length < 2 || !isGrokCanvasVideoModel(model)) return null;
    const pair = inferDirectReferencePair(prompt, referenceImages.length);
    if (!pair) return null;
    const baseReference = referenceImages[pair.base - 1];
    const productReference = referenceImages[pair.reference - 1];
    if (!baseReference || !productReference) return null;
    const cleanedIntent = stripImageMentionRoles(prompt);
    const productScalePrompt = buildVideoProductScalePrompt(productScaleMode);
    return {
        referenceImages: [productReference],
        bridgeReferences: [baseReference, productReference],
        bridgePrompt: [
            "Create one vertical ecommerce video keyframe that safely combines the references.",
            "Image 1 is the scene/person/mood reference. Preserve its camera feeling, lighting direction, and lifestyle atmosphere, but do not need to copy every detail.",
            "Image 2 is the exact product/object identity reference. Reproduce this product as a separate physical object with the same silhouette, proportions, transparent/solid material, red/white pattern, part count, and part placement.",
            "Place the product naturally in the scene as a believable product reveal or product hero moment. If full person-product interaction risks product deformation, prefer a clean tabletop/hand-held product hero keyframe.",
            "Do not stretch, elongate, melt, simplify, duplicate, remove, rotate into a new design, or reimagine any product/object part.",
            productScalePrompt,
            "No captions, no UI, no panel grid, no badges, no fake platform labels. Output a single polished keyframe only.",
            `User intent: ${limitInlinePrompt(cleanedIntent || "Create a short commerce video around the locked product reference.", 900)}`,
        ].join("\n"),
        videoPrompt: [
            "PRODUCT-LOCKED KEYFRAME VIDEO.",
            "<IMAGE_1> is the approved bridge keyframe and must be used as the visual opening foundation.",
            "The original product identity has already been composited into this keyframe. Keep the visible product/object faithful to the opening frame; do not redesign it or add/remove parts.",
            "Animate with subtle camera motion, natural hand/product movement, and short commerce rhythm. Keep the product separate from the body and stable in shape across the whole clip.",
            "If the presenter appears to speak, animate natural synchronized lips and facial micro-expressions. Otherwise use off-screen voiceover with B-roll.",
            `User intent: ${limitInlinePrompt(cleanedIntent || "Create a short commerce video around the locked product reference.", 900)}`,
        ].join("\n"),
        prompt: [
            "PRODUCT-LOCKED DIRECT VIDEO.",
            "The system will first create a product-locked bridge keyframe from the referenced scene/person and product images, then animate that keyframe. Do not use raw multi-reference Grok fusion as the final video source.",
            `User intent: ${limitInlinePrompt(cleanedIntent || "Create a short commerce video around the locked product reference.", 900)}`,
        ].join("\n"),
    };
}

type VideoBridgeStageReporter = (statusMessage: string) => void;

async function createDirectProductBridgeReference(config: AiConfig, context: NonNullable<ReturnType<typeof buildDirectProductLockVideoContext>>, size: string, signal?: AbortSignal, reportStage?: VideoBridgeStageReporter): Promise<ReferenceImage> {
    const bridgeConfig = {
        ...config,
        count: "1",
        size: size || config.size || "9:16",
        quality: config.quality === "auto" ? "high" : config.quality,
    };
    const image = await requestVideoBridgeImage(bridgeConfig, context.bridgePrompt, context.bridgeReferences, signal, reportStage);
    if (!image?.dataUrl) throw new Error("产品锁定关键帧生成失败，请重试");
    const uploaded = await uploadImage(image.dataUrl);
    return {
        id: `product-bridge:${nanoid()}`,
        name: "产品锁定关键帧.png",
        type: uploaded.mimeType || "image/png",
        dataUrl: uploaded.url,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
    };
}

type StoryboardVideoBridgeContext = {
    openingCandidate?: ReferenceImage;
    identityReferences: ReferenceImage[];
    storyboardReference?: ReferenceImage;
    plan: CanvasCommerceVideoPlan;
    productScaleMode?: string;
};

async function createStoryboardVideoBridgeReference(config: AiConfig, context: StoryboardVideoBridgeContext, size: string, signal?: AbortSignal, reportStage?: VideoBridgeStageReporter): Promise<ReferenceImage> {
    const bridgeConfig = {
        ...config,
        count: "1",
        size: size || config.size || "9:16",
        quality: config.quality === "auto" ? "high" : config.quality,
    };
    const identityLimit = Math.max(0, STORYBOARD_BRIDGE_MAX_REFERENCES - (context.openingCandidate ? 1 : 0) - (context.storyboardReference ? 1 : 0));
    const identityReferences = context.identityReferences.slice(0, identityLimit);
    const references = mergeReferenceImages(context.openingCandidate ? [context.openingCandidate] : [], identityReferences, context.storyboardReference ? [context.storyboardReference] : []).slice(0, STORYBOARD_BRIDGE_MAX_REFERENCES);
    if (!references.length) throw new Error("找不到分镜、关键帧或身份参考图，无法重建视频首帧");

    const imageNumber = (reference: ReferenceImage | undefined) => {
        if (!reference) return 0;
        const key = reference.storageKey || reference.url || reference.id || reference.dataUrl;
        const index = references.findIndex((item) => (item.storageKey || item.url || item.id || item.dataUrl) === key);
        return index < 0 ? 0 : index + 1;
    };
    const openingImageNumber = imageNumber(context.openingCandidate);
    const storyboardImageNumber = imageNumber(context.storyboardReference);
    const identityImageNumbers = identityReferences.map(imageNumber).filter((index) => index > 0);
    const firstBeat = [...(context.plan.beats || [])].sort((a, b) => a.index - b.index)[0];
    const mode = resolveStoryboardMode(context.plan);
    const needsPresenter = mode === "apparel" || mode === "subject" || context.plan.audioPlan?.mode === "mixed" || context.plan.audioPlan?.mode === "on-camera";
    const referenceRoles = [
        openingImageNumber ? `Image ${openingImageNumber} is a clean opening candidate. Preserve its visible face, body, wardrobe, product, camera angle, and environment.` : "",
        identityImageNumbers.length ? `Images ${identityImageNumbers.join(", ")} are the original identity, product, wardrobe, or scene sources. Their visible identities and rigid-object geometry override the storyboard whenever details differ.` : "",
        storyboardImageNumber ? `Image ${storyboardImageNumber} is the complete storyboard contact sheet. Use it only to understand the recurring presenter, product, environment, and opening action; never copy its grid layout or panel boundaries.` : "",
    ]
        .filter(Boolean)
        .join("\n");
    const presenterDirection = needsPresenter
        ? "Show one stable face-visible adult presenter in a medium or chest-up composition with the complete head, neck, shoulders, torso, and two separate natural arms. Keep the mouth readable for the opening spoken sentence."
        : "Do not invent a presenter when the references and plan are product-only or scene-only.";
    const productDirection =
        mode === "product"
            ? "Keep the exact referenced product clearly visible at natural scale as a separate rigid object. Preserve its silhouette, closure, component count, colors, label blocks, and relationship to hands and body."
            : "Do not add a product, bottle, package, or tool that is absent from the plan and references.";
    const bridgePrompt = [
        `Create exactly one clean high-resolution ${videoAspectRatioForSize(bridgeConfig.size)} opening keyframe for the planned short video.`,
        referenceRoles,
        firstBeat?.description ? `Opening action: ${limitInlinePrompt(firstBeat.description, 500)}` : "Make the planned opening action immediately readable.",
        presenterDirection,
        productDirection,
        buildVideoProductScalePrompt(context.productScaleMode),
        "Preserve realistic anatomy, straight natural posture, clean hands, photographic lighting, and believable contact. Do not stretch, bend, melt, duplicate, average identities, or reconstruct a collage.",
        "Output one polished full-frame photograph only: no grid, split screen, border, caption, subtitle, watermark, UI, price, or offer.",
    ]
        .filter(Boolean)
        .join("\n");
    const image = await requestVideoBridgeImage(bridgeConfig, bridgePrompt, references, signal, reportStage);
    if (!image?.dataUrl) throw new Error("分镜视频首帧重建失败，请重试");
    const uploaded = await uploadImage(image.dataUrl);
    return {
        id: `storyboard-bridge:${nanoid()}`,
        name: "分镜视频锁定首帧.png",
        type: uploaded.mimeType || "image/png",
        dataUrl: uploaded.url,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
    };
}

async function requestVideoBridgeImage(config: AiConfig, prompt: string, references: ReferenceImage[], signal?: AbortSignal, reportStage?: VideoBridgeStageReporter) {
    reportStage?.("正在重建高清首帧...");
    try {
        return await requestVideoBridgeImageAttempt(config, prompt, references, VIDEO_BRIDGE_PRIMARY_TIMEOUT_MS, signal);
    } catch (error) {
        if (signal?.aborted) throw new Error("请求已取消");
        if (!isRetryableVideoBridgeError(error)) throw new Error(`高清首帧重建失败：${videoBridgeErrorMessage(error)}`);
        const fallbackModel = resolveVideoBridgeFallbackModel(config);
        if (!fallbackModel) throw new Error(`高清首帧重建失败：${videoBridgeErrorMessage(error)}`);

        reportStage?.("首帧服务繁忙，正在切换备用模型...");
        const fallbackConfig = { ...config, model: fallbackModel, imageModel: fallbackModel };
        try {
            return await requestVideoBridgeImageAttempt(fallbackConfig, prompt, references, VIDEO_BRIDGE_FALLBACK_TIMEOUT_MS, signal);
        } catch (fallbackError) {
            if (signal?.aborted) throw new Error("请求已取消");
            throw new Error(`高清首帧重建失败：${videoBridgeErrorMessage(fallbackError)}`);
        }
    }
}

async function requestVideoBridgeImageAttempt(config: AiConfig, prompt: string, references: ReferenceImage[], timeoutMs: number, parentSignal?: AbortSignal) {
    if (parentSignal?.aborted) throw new Error("请求已取消");
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        const image = await requestEdit(config, prompt, references, undefined, { signal: controller.signal }).then((items) => items[0]);
        if (!image?.dataUrl) throw new Error("首帧生成服务没有返回图片");
        return image;
    } catch (error) {
        if (parentSignal?.aborted) throw new Error("请求已取消");
        if (timedOut) throw new Error("视频首帧重建超时");
        throw error;
    } finally {
        clearTimeout(timeout);
        parentSignal?.removeEventListener("abort", abortFromParent);
    }
}

function resolveVideoBridgeFallbackModel(config: AiConfig) {
    const currentModel = modelOptionName(config.model || config.imageModel);
    const options = [...config.imageModels, ...config.models];
    for (const fallbackName of VIDEO_BRIDGE_FALLBACK_IMAGE_MODELS) {
        if (fallbackName === currentModel) continue;
        const option = options.find((model) => modelOptionName(model) === fallbackName);
        if (option) return option;
    }
    return "";
}

function isRetryableVideoBridgeError(error: unknown) {
    const message = videoBridgeErrorMessage(error).toLowerCase();
    return /timeout|timed out|network|connection|socket|upstream|internal server|502|503|504|超时|繁忙|暂时|连接|中断|上游/.test(message);
}

function videoBridgeErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "首帧生成服务暂时不可用";
    return message.trim().slice(0, 180) || "首帧生成服务暂时不可用";
}

function isGrokCanvasVideoModel(model: string) {
    return isGrokVideoModel(model);
}

function inferDirectReferencePair(prompt: string, referenceCount: number) {
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

function stripImageMentionRoles(prompt: string) {
    return prompt
        .replace(
            /(?:让|用|以)?\s*(?:@?\s*)?(?:图片|图像|图|image|img|photo|picture)\s*[1-9]\d*\s*(?:参考|参照|借鉴|依据|按照|根据|reference|references|refer(?:s)? to|based on|using|with)\s*(?:@?\s*)?(?:图片|图像|图|image|img|photo|picture)\s*[1-9]\d*/gi,
            "根据锁定产品参考图",
        )
        .replace(
            /(?:让|用|以)?\s*(?:@?\s*)?(?:图片|图像|图|image|img|photo|picture)\s*[1-9]\d*\s*(?:带|带着|拿|拿着|手持|展示|使用|融入|融合|加入|植入|结合|搭配|with|featuring|holding|using|showing|including|include|add(?:ing)?)\s*(?:@?\s*)?(?:图片|图像|图|image|img|photo|picture)\s*[1-9]\d*(?:\s*(?:产品|商品|物品|道具|object|product|item))?/gi,
            "根据锁定产品参考图",
        )
        .replace(/@?\s*(?:图片|图像|图|image|img|photo|picture)\s*[1-9]\d*/gi, "参考素材")
        .replace(/\s+/g, " ")
        .trim();
}

function mergeReferenceImages(...groups: ReferenceImage[][]) {
    const seen = new Set<string>();
    return groups.flat().filter((image) => {
        const key = image.storageKey || image.url || image.id || image.dataUrl;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
