"use client";

import { Box, Camera, ImagePlus, Sparkles } from "lucide-react";

import type { CanvasNodeData } from "../../types";

export function CanvasDirectorNode({ node, onOpen }: { node: CanvasNodeData; onOpen: (node: CanvasNodeData) => void }) {
    const hasSnapshot = Boolean(node.metadata?.directorLastSnapshot);
    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-[#171717] text-white">
            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                {hasSnapshot ? (
                    <img src={node.metadata?.directorLastSnapshot} alt="导演台截图" className="h-full w-full object-cover opacity-85" draggable={false} />
                ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(96,165,250,.24),transparent_34%),linear-gradient(180deg,#202020,#111111)]" />
                )}
                <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
                    <div className="grid size-14 place-items-center rounded-2xl bg-white/10 shadow-2xl backdrop-blur">
                        <Camera className="size-7" />
                    </div>
                    <div>
                        <div className="text-base font-semibold">导演台</div>
                        <div className="mt-1 text-xs leading-5 text-white/58">摆机位、截参考帧、接生图</div>
                    </div>
                    <button
                        type="button"
                        className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black shadow-lg transition hover:scale-[1.02]"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen(node);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <Box className="size-4" />
                        打开导演台
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 text-[11px] text-white/72">
                <div className="flex items-center justify-center gap-1.5 bg-black/28 px-2 py-2">
                    <ImagePlus className="size-3.5" />
                    自动出参考帧
                </div>
                <div className="flex items-center justify-center gap-1.5 bg-black/28 px-2 py-2">
                    <Sparkles className="size-3.5" />
                    多角度生图
                </div>
            </div>
        </div>
    );
}

export function CanvasDirectorPanel({ node, onOpen }: { node: CanvasNodeData; onOpen: (node: CanvasNodeData) => void }) {
    return (
        <div className="rounded-[18px] border border-white/10 bg-[#1b1b1b] p-3 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold">导演台</div>
                    <div className="mt-1 text-xs leading-5 text-white/52">截图会自动变成图片节点，并连到生图配置。</div>
                </div>
                <button
                    type="button"
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:scale-[1.02]"
                    onClick={() => onOpen(node)}
                >
                    <Camera className="size-4" />
                    打开
                </button>
            </div>
            {node.metadata?.directorSnapshotNodeId ? <div className="mt-3 rounded-xl bg-white/6 px-3 py-2 text-xs text-white/58">最近参考帧已生成，可继续打开导演台调整机位。</div> : null}
        </div>
    );
}
