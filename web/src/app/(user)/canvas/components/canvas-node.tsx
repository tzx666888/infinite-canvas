"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, Image as ImageIcon, Music2, RefreshCw, Star, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type PanelResizeEdge = "left" | "right" | "bottom" | "bottom-right";
const selectionBlue = "#2f80ff";
const PANEL_DEFAULT_WIDTH = 500;
const PANEL_MIN_WIDTH = 360;
const PANEL_MAX_WIDTH = 960;
const PANEL_DEFAULT_TEXTAREA_HEIGHT = 96;
const PANEL_MIN_TEXTAREA_HEIGHT = 72;
const PANEL_MAX_TEXTAREA_HEIGHT = 360;
const LEGACY_STORYBOARD_REVIEW_VIDEO_ERROR = "12宫格分镜候选不能直接生成视频";

type ScrollableWheelEvent = {
    deltaX: number;
    deltaY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
};

function scrollElementWithWheel(element: HTMLElement, event: ScrollableWheelEvent) {
    const canScrollY = element.scrollHeight > element.clientHeight;
    const canScrollX = element.scrollWidth > element.clientWidth;
    if (!canScrollY && !canScrollX) return;

    event.preventDefault();
    event.stopPropagation();

    if (canScrollY && event.deltaY !== 0) {
        element.scrollTop += event.deltaY;
    }
    if (canScrollX && event.deltaX !== 0) {
        element.scrollLeft += event.deltaX;
    }
}

function bindScrollableWheel(element: HTMLElement) {
    const handleWheel = (event: WheelEvent) => {
        if (event.defaultPrevented) return;
        scrollElementWithWheel(element, event);
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
}

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    resourceLabel?: CanvasResourceReference;
    mentionReferences?: CanvasResourceReference[];
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.PointerEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    resourceLabel,
    mentionReferences = [],
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onContentChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onGenerateImage,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
    const [panelTextareaHeight, setPanelTextareaHeight] = useState(PANEL_DEFAULT_TEXTAREA_HEIGHT);
    const [panelOffsetX, setPanelOffsetX] = useState(0);
    const [isPanelResizing, setIsPanelResizing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });
    const panelResizeRef = useRef({
        active: false,
        edge: "right" as PanelResizeEdge,
        startX: 0,
        startY: 0,
        startWidth: PANEL_DEFAULT_WIDTH,
        startHeight: PANEL_DEFAULT_TEXTAREA_HEIGHT,
        startOffsetX: 0,
    });

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        return bindScrollableWheel(textarea);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video,
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    const handlePanelResizeMove = useCallback(
        (event: PointerEvent) => {
            if (!panelResizeRef.current.active) return;

            event.preventDefault();
            const dx = (event.clientX - panelResizeRef.current.startX) / scale;
            const dy = (event.clientY - panelResizeRef.current.startY) / scale;
            const { edge } = panelResizeRef.current;

            if (edge === "left" || edge === "right" || edge === "bottom-right") {
                const delta = edge === "left" ? -dx : dx;
                const nextWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, panelResizeRef.current.startWidth + delta));
                const deltaWidth = nextWidth - panelResizeRef.current.startWidth;
                const nextOffsetX = edge === "left" ? panelResizeRef.current.startOffsetX - deltaWidth / 2 : panelResizeRef.current.startOffsetX + deltaWidth / 2;

                setPanelWidth(nextWidth);
                setPanelOffsetX(nextOffsetX);
            }

            if (edge === "bottom" || edge === "bottom-right") {
                const nextHeight = Math.min(PANEL_MAX_TEXTAREA_HEIGHT, Math.max(PANEL_MIN_TEXTAREA_HEIGHT, panelResizeRef.current.startHeight + dy));
                setPanelTextareaHeight(nextHeight);
            }
        },
        [scale],
    );

    const handlePanelResizeUp = useCallback(() => {
        panelResizeRef.current.active = false;
        setIsPanelResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePanelResizeMove);
        window.removeEventListener("pointerup", handlePanelResizeUp);
    }, [handlePanelResizeMove]);

    const handlePanelResizePointerDown = (event: React.PointerEvent, edge: PanelResizeEdge) => {
        event.stopPropagation();
        event.preventDefault();
        panelResizeRef.current = {
            active: true,
            edge,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: panelWidth,
            startHeight: panelTextareaHeight,
            startOffsetX: panelOffsetX,
        };
        setIsPanelResizing(true);
        document.body.style.cursor = panelResizeCursor(edge);
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", handlePanelResizeMove);
        window.addEventListener("pointerup", handlePanelResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
            window.removeEventListener("pointermove", handlePanelResizeMove);
            window.removeEventListener("pointerup", handlePanelResizeUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
    }, [handlePanelResizeMove, handlePanelResizeUp, handleResizeMove, handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            <div
                className="relative h-full w-full overflow-visible rounded-3xl border-2"
                style={{
                    background: hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                    borderColor: hasImageContent ? imageBorderColor : isActive ? selectionBlue : isRelated ? theme.node.muted : theme.node.stroke,
                    boxShadow: isActive ? `0 0 0 1px ${selectionBlue}55` : isRelated && !isBatchChild ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onGenerateImage={onGenerateImage}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {resourceLabel ? <ResourceLabelBadge reference={resourceLabel} /> : null}

                {!hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
            </div>

            <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onPointerDown={(event) => onConnectStart(event, data.id, "target")} />
            <ConnectionHandleDot side="right" visible={data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} onPointerDown={(event) => onConnectStart(event, data.id, "source")} />

            {showPanel && renderPanel ? (
                <div className="absolute top-full z-[70] -translate-x-1/2 pt-4" style={{ left: `calc(50% + ${panelOffsetX}px)`, width: panelWidth, "--canvas-prompt-textarea-height": `${panelTextareaHeight}px` } as React.CSSProperties}>
                    <PanelResizeHandle edge="left" active={isPanelResizing} onPointerDown={handlePanelResizePointerDown} />
                    <PanelResizeHandle edge="right" active={isPanelResizing} onPointerDown={handlePanelResizePointerDown} />
                    <PanelResizeHandle edge="bottom" active={isPanelResizing} onPointerDown={handlePanelResizePointerDown} />
                    <PanelResizeHandle edge="bottom-right" active={isPanelResizing} onPointerDown={handlePanelResizePointerDown} />
                    {renderPanel(data)}
                </div>
            ) : null}
        </div>
    );
});

function PanelResizeHandle({ edge, active, onPointerDown }: { edge: PanelResizeEdge; active: boolean; onPointerDown: (event: React.PointerEvent, edge: PanelResizeEdge) => void }) {
    if (edge === "bottom") {
        return (
            <button type="button" className="group absolute -bottom-2 left-8 right-8 z-20 h-4 cursor-row-resize touch-none" onPointerDown={(event) => onPointerDown(event, edge)} aria-label="上下调整面板高度">
                <span className={`absolute left-1/2 top-1/2 h-1 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 transition group-hover:bg-sky-300 ${active ? "opacity-100" : "opacity-70"}`} />
            </button>
        );
    }

    if (edge === "bottom-right") {
        return (
            <button type="button" className="group absolute -bottom-2 -right-2 z-30 size-5 cursor-nwse-resize touch-none" onPointerDown={(event) => onPointerDown(event, edge)} aria-label="右下调整面板宽高">
                <span className={`absolute bottom-1 right-1 size-2 rounded-br-md border-b-2 border-r-2 border-white/45 transition group-hover:border-sky-300 ${active ? "opacity-100" : "opacity-75"}`} />
            </button>
        );
    }

    const sideClass = edge === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2";
    return (
        <button type="button" className={`group absolute bottom-4 top-4 z-20 w-4 cursor-col-resize touch-none ${sideClass}`} onPointerDown={(event) => onPointerDown(event, edge)} aria-label={edge === "left" ? "向左调整面板宽度" : "向右调整面板宽度"}>
            <span className={`absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 transition group-hover:bg-sky-300 ${active ? "opacity-100" : "opacity-70"}`} />
        </button>
    );
}

function panelResizeCursor(edge: PanelResizeEdge) {
    if (edge === "bottom") return "row-resize";
    if (edge === "bottom-right") return "nwse-resize";
    return "col-resize";
}

function NodeContent(props: NodeContentRendererProps): React.ReactElement | null {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) {
        return <>{props.renderNodeContent(props.node) ?? null}</>;
    }
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent theme={props.theme} label={props.node.metadata?.statusMessage} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type];
    return Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function LoadingContent({ theme, label }: Pick<NodeContentRendererProps, "theme"> & { label?: string }) {
    const elapsedSeconds = useLoadingElapsedSeconds();

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <div className="max-w-[86%] space-y-1 text-center">
                <div className="truncate text-[10px] tracking-[0.2em]">{label || "生成中"}</div>
                <div className="text-[11px] leading-4 opacity-70">已用 {formatElapsedSeconds(elapsedSeconds)}</div>
            </div>
        </div>
    );
}

function useLoadingElapsedSeconds() {
    const startedAtRef = useRef(Date.now());
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        const update = () => setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, []);

    return elapsedSeconds;
}

function formatElapsedSeconds(seconds: number) {
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    return `${minutes} 分 ${restSeconds} 秒`;
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const error = describeNodeError(node.metadata?.errorDetails);
    return (
        <div className="flex max-w-[280px] flex-col items-center gap-3 px-5 text-center">
            <div className="grid size-9 place-items-center rounded-full bg-red-500/10 text-red-300">
                <AlertTriangle className="size-4" />
            </div>
            <div className="space-y-1">
                <div className="text-sm font-semibold text-red-200">{error.title}</div>
                <div className="text-xs leading-5 text-red-200/85">{error.message}</div>
                {error.detail ? (
                    <div className="max-h-12 overflow-hidden text-[10px] leading-4 text-red-200/55" title={error.detail}>
                        {error.detail}
                    </div>
                ) : null}
            </div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button>
        </div>
    );
}

function describeNodeError(errorDetails?: string) {
    const detail = errorDetails?.trim();
    const text = detail || "生成失败";
    const lower = text.toLowerCase();

    if (text.includes(LEGACY_STORYBOARD_REVIEW_VIDEO_ERROR)) {
        return {
            title: "宫格视频链路已更新",
            message: "现在支持用 12 宫格分镜作为视频参考，点重试会自动按新链路生成。",
            detail: text,
        };
    }

    if (/429|rate limit|too many|频率|限流|排队|quota/.test(lower) || /限流|频率|排队/.test(text)) {
        return { title: "请求太密集", message: "系统已保留节点和提示词，稍等片刻后点重试即可。", detail };
    }

    if (/timeout|timed out|524|gateway|upstream|超时/.test(lower) || /超时|上游/.test(text)) {
        return { title: "上游响应超时", message: "素材和参数没有丢，通常直接重试就能继续。", detail };
    }

    if (/danger_filter|safety|policy|content filter|unsafe|安全|违规|风控/.test(lower) || /安全|违规|风控/.test(text)) {
        return { title: "触发安全过滤", message: "换成更中性的动作、镜头或文案后再重试。", detail };
    }

    if (/401|403|api key|token|permission|unauthorized|forbidden|令牌|权限|未开放/.test(lower) || /令牌|权限|未开放/.test(text)) {
        return { title: "令牌或模型权限不足", message: "检查当前令牌是否可用，或切换到已开放的模型再重试。", detail };
    }

    if (/404|not_found|model not found|模型不存在|模型不可用/.test(lower) || /模型不存在|模型不可用/.test(text)) {
        return { title: "模型不可用", message: "当前模型暂不可用，切换模型或稍后重试。", detail };
    }

    if (/reference|storage|mask|lost|missing|参考图片|素材|蒙版|丢失/.test(lower) || /参考图片|素材|蒙版|丢失/.test(text)) {
        return { title: "参考素材丢失", message: "重新上传或重新连接参考图后再生成。", detail };
    }

    if (/abort|canceled|cancelled|中断|取消/.test(lower) || /中断|取消/.test(text)) {
        return { title: "任务已中断", message: "节点已保留，可以重新生成。", detail };
    }

    return { title: "生成失败", message: "节点已保留，查看提示词或参考图后可直接重试。", detail };
}

function UnknownNodeContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;
    const isStoryboardPlan = Boolean(node.metadata?.commerceVideoPlan?.beats?.length);
    const displayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isEditingContent) return;
        const display = displayRef.current;
        if (!display) return;

        return bindScrollableWheel(display);
    }, [isEditingContent, node.id]);

    return (
        <div
            data-canvas-no-zoom
            className="flex h-full w-full flex-col overflow-hidden pt-8"
            onWheelCapture={(event) => {
                const scroller = isEditingContent ? textareaRef?.current : displayRef.current;
                if (scroller) scrollElementWithWheel(scroller, event);
            }}
            onWheel={(event) => event.stopPropagation()}
        >
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={isStoryboardPlan ? "生成12宫格分镜候选" : "用文本生图"}
                aria-label={isStoryboardPlan ? "生成12宫格分镜候选" : "用文本生图"}
            >
                <ImageIcon className="size-3.5" />
                {isStoryboardPlan ? "宫格" : "生图"}
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    data-canvas-no-zoom
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheelCapture={(event) => scrollElementWithWheel(event.currentTarget, event)}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div
                    ref={displayRef}
                    data-canvas-no-zoom
                    className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono"
                    style={textStyle}
                    onWheelCapture={(event) => scrollElementWithWheel(event.currentTarget, event)}
                    onWheel={(event) => event.stopPropagation()}
                >
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

function ResourceLabelBadge({ reference }: { reference: CanvasResourceReference }) {
    return <span className={`pointer-events-none absolute right-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${reference.active ? "bg-[#2f80ff] text-white shadow-sm" : "bg-black/35 text-white/75"}`}>{reference.label}</span>;
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent theme={props.theme} label={props.node.metadata?.statusMessage} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [duration, setDuration] = useState<number | null>(null);

    useEffect(() => {
        if (!node.metadata?.content) return;
        if (node.metadata.durationMs) {
            setDuration(node.metadata.durationMs / 1000);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        const handleMetadata = () => {
            if (Number.isFinite(video.duration)) setDuration(video.duration);
        };
        video.addEventListener("loadedmetadata", handleMetadata);
        if (video.readyState >= 1 && Number.isFinite(video.duration)) setDuration(video.duration);
        return () => video.removeEventListener("loadedmetadata", handleMetadata);
    }, [node.metadata?.content, node.metadata?.durationMs]);

    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );

    const durationLabel = duration !== null ? `${Math.round(duration)}s` : node.metadata.seconds ? `${node.metadata.seconds}s` : null;

    return (
        <div className="relative h-full w-full">
            <video ref={videoRef} src={node.metadata.content} controls className="h-full w-full rounded-[18px] bg-black object-contain" data-canvas-no-zoom />
            {durationLabel ? <span className="pointer-events-none absolute bottom-1 left-2 rounded bg-black/60 px-1 py-px text-[6px] tabular-nums text-white/80">{durationLabel}</span> : null}
        </div>
    );
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">空音频节点</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{node.title || "音频"}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-3xl">
                <img
                    src={node.metadata!.content!}
                    alt={node.title}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                />
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-[#2f80ff]">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, visible, onPointerDown }: { side: "left" | "right"; visible: boolean; onPointerDown: (event: React.PointerEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onPointerDown={onPointerDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
        </div>
    );
}
