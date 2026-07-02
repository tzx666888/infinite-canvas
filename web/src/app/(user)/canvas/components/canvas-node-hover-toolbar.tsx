"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Dropdown, Modal, Popconfirm, Segmented, Tooltip } from "antd";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, MessageSquare, Minus, Music2, Pencil, Plus, RefreshCw, Settings2, Trash2, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "../types";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onGenerateStoryboardKeyframes: (node: CanvasNodeData) => void;
    onGenerateVideoClips: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onReverseVideoPrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    confirmTitle?: string;
    confirmDescription?: string;
    confirmOkText?: string;
};

const coreImageToolIds = new Set<ImageQuickToolId>(["saveAsset", "download"]);

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    onKeep,
    onLeave,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onGenerateStoryboardKeyframes,
    onGenerateVideoClips,
    onUpload,
    onDownload,
    onSaveAsset,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onReversePrompt,
    onReverseVideoPrompt,
    onRetry,
    onToggleFreeResize,
    onDelete,
}: CanvasNodeHoverToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(true);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const [imageMoreOpen, setImageMoreOpen] = useState(false);
    const [toolbarConfirmOpen, setToolbarConfirmOpen] = useState(false);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [toolbarSize, setToolbarSize] = useState({ width: 720, height: 52 });
    const [windowSize, setWindowSize] = useState(() => ({
        width: typeof window === "undefined" ? 1440 : window.innerWidth,
        height: typeof window === "undefined" ? 900 : window.innerHeight,
    }));
    const { message } = App.useApp();
    const copyText = useCopyText();

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(ensureCoreImageToolIds(config.ids));
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
        setImageMoreOpen(false);
        setToolbarConfirmOpen(false);
    }, [node?.id]);

    useEffect(() => {
        const updateWindowSize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        updateWindowSize();
        window.addEventListener("resize", updateWindowSize);
        return () => window.removeEventListener("resize", updateWindowSize);
    }, []);

    useLayoutEffect(() => {
        const rect = toolbarRef.current?.getBoundingClientRect();
        if (!rect) return;
        setToolbarSize((current) => {
            const width = Math.round(rect.width);
            const height = Math.round(rect.height);
            return current.width === width && current.height === height ? current : { width, height };
        });
    });

    if (!node) return null;

    const nodeId = node.id;
    const rawLeft = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const rawTop = viewport.y + node.position.y * viewport.k - 14;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isStoryboardReviewSheet = isImage && node.metadata?.storyboardRole === "review-sheet";
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || hasImage || isVideo;
    const canRetry = node.metadata?.status === "error";
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onMaskEdit, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        onKeep(nodeId);
        setDraftImageToolIds(ensureCoreImageToolIds(quickImageToolIds));
        setDraftShowImageToolLabels(true);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        {
            id: "delete",
            title: "移除节点",
            label: "删除",
            icon: <Trash2 className="size-4" />,
            onClick: () => onDelete(node),
            danger: true,
            confirmTitle: "删除这个节点？",
            confirmDescription: "会同时移除与它相连的引线。",
            confirmOkText: "删除",
        },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: "重新生成", label: "重试", icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: "加入我的素材", label: "存素材", icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: hasAudio ? "下载音频" : hasVideo ? "下载视频" : "下载图片", label: "下载", icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog ? [{ id: "edit", title: "编辑", label: "编辑", icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: "编辑文本", label: "编辑文字", icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }] : []),
        ...(isText
            ? [
                  {
                      id: "generateImage",
                      title: node.metadata?.commerceVideoPlan ? "生成12宫格分镜候选" : "用文本生图",
                      label: node.metadata?.commerceVideoPlan ? "宫格" : "生图",
                      icon: <ImageIcon className="size-4" />,
                      onClick: () => onGenerateImage(node),
                  },
              ]
            : []),
        ...(isText && node.metadata?.commerceVideoPlan ? [{ id: "generateVideoClips", title: "从分镜生成视频片段", label: "生成视频", icon: <Video className="size-4" />, onClick: () => onGenerateVideoClips(node) }] : []),
        ...(isStoryboardReviewSheet && hasImage ? [{ id: "generateStoryboardKeyframes", title: "从这张12宫格生成干净关键帧", label: "关键帧", icon: <ImageIcon className="size-4" />, onClick: () => onGenerateStoryboardKeyframes(node) }] : []),
        ...(isConfig ? [{ id: "config", title: "生成配置", label: "生成配置", icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: "减小字号", label: "缩小", icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: "增大字号", label: "放大", icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: "上传图片", label: "上传图片", icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: hasVideo ? "替换视频" : "上传视频", label: hasVideo ? "替换视频" : "上传视频", icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasVideo ? [{ id: "reverseVideoPrompt", title: "反推视频提示词", label: "反推", icon: <MessageSquare className="size-4" />, onClick: () => onReverseVideoPrompt(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: hasAudio ? "替换音频" : "上传音频", label: hasAudio ? "替换音频" : "上传音频", icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const allToolbarTools = [...baseToolbarTools, ...nodeToolbarTools];
    const forcedImageToolIds = new Set(["generateStoryboardKeyframes", "retry"]);
    const toolbarTools = hasImage ? allToolbarTools.filter((tool) => tool.id !== "delete" && (coreImageToolIds.has(tool.id as ImageQuickToolId) || forcedImageToolIds.has(tool.id) || quickImageToolIdSet.has(tool.id as ImageQuickToolId))) : allToolbarTools;
    const deleteTool = hasImage ? allToolbarTools.find((tool) => tool.id === "delete") : null;
    const overflowTools = hasImage ? allToolbarTools.filter((tool) => tool.id !== "delete" && !toolbarTools.some((visibleTool) => visibleTool.id === tool.id)) : [];
    const overflowMenu = {
        items: overflowTools.map((tool) => ({
            key: tool.id,
            icon: tool.icon,
            label: tool.label,
            danger: tool.danger,
        })),
        onClick: ({ key }: { key: string }) => {
            const tool = overflowTools.find((item) => item.id === key);
            if (!tool) return;
            onKeep(nodeId);
            setImageMoreOpen(false);
            tool.onClick();
        },
    };
    const selectableImageToolbarTools = allToolbarTools
        .filter((tool) => tool.id !== "retry" && tool.id !== "delete" && !forcedImageToolIds.has(tool.id))
        .map((tool) => ({ ...tool, locked: coreImageToolIds.has(tool.id as ImageQuickToolId) })) as ImageToolbarSettingsTool[];
    const edgePadding = 12;
    const minLeft = toolbarSize.width / 2 + edgePadding;
    const maxLeft = windowSize.width - toolbarSize.width / 2 - edgePadding;
    const left = minLeft > maxLeft ? windowSize.width / 2 : Math.min(Math.max(rawLeft, minLeft), maxLeft);
    const nodeBottom = viewport.y + (node.position.y + node.height) * viewport.k;
    const unclampedTop = rawTop - toolbarSize.height < 68 ? nodeBottom + toolbarSize.height + 12 : rawTop;
    const top = Math.min(unclampedTop, windowSize.height - edgePadding);

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        if (coreImageToolIds.has(id) && !visible) return;
        setDraftImageToolIds((current) => {
            const selected = new Set(current);
            if (visible) selected.add(id);
            else selected.delete(id);
            return selectableImageToolbarTools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
        });
    };

    const resetImageToolSettings = () => {
        setDraftImageToolIds(defaultImageQuickToolIds);
        setDraftShowImageToolLabels(true);
    };

    const saveImageToolSettings = () => {
        const config = { ids: ensureCoreImageToolIds(draftImageToolIds), showLabels: true };
        setQuickImageToolIds(config.ids);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    return (
        <>
            <div
                ref={toolbarRef}
                className="thin-scrollbar absolute z-[70] flex max-h-[156px] -translate-x-1/2 -translate-y-full flex-wrap items-center gap-x-1 gap-y-1 overflow-x-hidden overflow-y-auto rounded-[18px] border border-black/10 bg-white px-2 py-1.5 text-[14px] leading-none text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                style={{ left, top, maxWidth: "min(760px, calc(100vw - 24px))" }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen && !imageMoreOpen && !toolbarConfirmOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {toolbarTools.map((tool) => (
                    <ToolbarAction key={tool.id} {...tool} showLabel={true} onConfirmOpenChange={setToolbarConfirmOpen} />
                ))}
                {hasImage && overflowTools.length ? (
                    <Dropdown
                        menu={overflowMenu}
                        trigger={["click"]}
                        placement="bottom"
                        overlayClassName="canvas-image-toolbar-more-menu"
                        open={imageMoreOpen}
                        onOpenChange={(open) => {
                            setImageMoreOpen(open);
                            if (open) onKeep(nodeId);
                        }}
                    >
                        <span>
                            <ToolbarAction id="more" title="更多图片工具" label="更多" icon={<Ellipsis className="size-4" />} onClick={() => onKeep(nodeId)} showLabel={true} />
                        </span>
                    </Dropdown>
                ) : null}
                {hasImage ? <ToolbarAction id="settings" title="自定义快捷工具" label="工具" icon={<Settings2 className="size-4" />} active={imageToolSettingsOpen} onClick={openImageToolSettings} showLabel={true} /> : null}
                {hasImage && deleteTool ? (
                    <>
                        <span className="mx-1 h-7 w-px shrink-0 bg-black/10" />
                        <ToolbarAction {...deleteTool} showLabel={true} onConfirmOpenChange={setToolbarConfirmOpen} />
                    </>
                ) : null}
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onReset={resetImageToolSettings}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

function ensureCoreImageToolIds(ids: ImageQuickToolId[]) {
    const selected = new Set<ImageQuickToolId>(ids.length ? ids : defaultImageQuickToolIds);
    coreImageToolIds.forEach((id) => selected.add(id));
    return defaultImageQuickToolIds.filter((id) => selected.has(id)).concat(ids.filter((id) => !defaultImageQuickToolIds.includes(id) && selected.has(id)));
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "title") return undefined;
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>节点信息</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: "信息", value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] text-sm">
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label="类型" value={node.type === CanvasNodeType.Text ? "文本" : node.type === CanvasNodeType.Image ? "图片" : node.type === CanvasNodeType.Video ? "视频" : node.type === CanvasNodeType.Audio ? "音频" : "生成配置"} />
                            <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label="状态" value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                            {node.metadata?.prompt ? <InfoRow label="提示词" value={node.metadata.prompt} /> : null}
                            {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, showLabel, active = false, danger = false, confirmTitle, confirmDescription, confirmOkText, onConfirmOpenChange }: ToolbarTool & { showLabel: boolean; onConfirmOpenChange?: (open: boolean) => void }) {
    const hasText = showLabel && Boolean(label);
    const button = (
        <button type="button" className={`group relative flex h-10 shrink-0 items-center whitespace-nowrap px-0.5 ${danger ? "text-[#ef4444]" : ""}`} onClick={confirmTitle ? undefined : onClick} aria-label={title}>
            <span className={`flex h-8 items-center ${hasText ? "gap-1.5 px-2.5" : "justify-center px-2"} rounded-lg transition group-hover:bg-[#f0f0f1] ${active ? "bg-[#eeeeef]" : ""}`}>
                <span className="shrink-0">{icon}</span>
                {hasText ? <span className="whitespace-nowrap text-[13px] font-medium">{label}</span> : null}
            </span>
        </button>
    );
    const action = confirmTitle ? (
        <Popconfirm title={confirmTitle} description={confirmDescription} okText={confirmOkText || "确认"} cancelText="取消" okButtonProps={{ danger }} onOpenChange={onConfirmOpenChange} onConfirm={onClick}>
            {button}
        </Popconfirm>
    ) : (
        button
    );

    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            {action}
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
