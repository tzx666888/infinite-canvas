"use client";

import type { CSSProperties, ReactNode } from "react";
import { Check, ChevronRight, LoaderCircle, RotateCcw, Sparkles, UserRound, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

import { CanvasNodeType, type CanvasAgentVideoBrief, type CanvasAgentVideoGuidePhase, type CanvasNodeData } from "../types";
import { agentVideoBriefSummary, nextAgentVideoGuideQuestion } from "../utils/canvas-agent-video-guide";

type CanvasAgentVideoGuideCardProps = {
    brief: CanvasAgentVideoBrief;
    config: AiConfig;
    nodes: CanvasNodeData[];
    phase: CanvasAgentVideoGuidePhase;
    busy?: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChoose: (patch: Partial<CanvasAgentVideoBrief>, label: string) => void;
    onGeneratePrompt: () => void;
    onConfirmPrompt: () => void;
    onReset: () => void;
};

export function CanvasAgentVideoGuideCard({ brief, config, nodes, phase, busy, theme, onChoose, onGeneratePrompt, onConfirmPrompt, onReset }: CanvasAgentVideoGuideCardProps) {
    if (!brief.productNodeId) return null;
    const question = nextAgentVideoGuideQuestion(config, brief);
    const product = nodes.find((node) => node.id === brief.productNodeId);
    const creatorCandidates = nodes.filter((node) => node.id !== brief.productNodeId && node.type === CanvasNodeType.Image && node.metadata?.content?.trim());
    const cardStyle = { borderColor: theme.node.stroke, background: theme.toolbar.panel, color: theme.node.text };

    if (phase === "prepared") {
        return (
            <GuideShell theme={theme} style={cardStyle}>
                <GuideHeader theme={theme} eyebrow="已准备" title="视频节点已按所选模型锁定" hint="需要更换模型、时长或人物时，请重新走一次引导，提示词会同步重编译。" />
                <button type="button" disabled={busy} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-45" style={{ borderColor: theme.node.stroke }} onClick={onReset}>
                    <RotateCcw className="size-4" />
                    重新制作视频
                </button>
            </GuideShell>
        );
    }

    if (phase === "drafting") {
        return (
            <GuideShell theme={theme} style={cardStyle}>
                <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                        <LoaderCircle className="size-5 animate-spin" />
                    </span>
                    <div>
                        <div className="text-sm font-semibold">正在生成模型适配提示词</div>
                        <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>已锁定全部选择，不会再重复提问。</div>
                    </div>
                </div>
            </GuideShell>
        );
    }

    if (phase === "review") {
        return (
            <GuideShell theme={theme} style={cardStyle}>
                <GuideHeader theme={theme} eyebrow="最后一步" title="确认刚才的提示词" hint="确认后只创建并连好视频节点，不会自动扣费生成。" />
                <div className="mt-3 rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {agentVideoBriefSummary(brief)}
                </div>
                <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
                    <button type="button" className="grid size-10 place-items-center rounded-xl border transition hover:opacity-75" style={{ borderColor: theme.node.stroke }} onClick={onReset} aria-label="重新选择">
                        <RotateCcw className="size-4" />
                    </button>
                    <button type="button" disabled={busy} className="flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45" style={{ background: theme.toolbar.activeText, color: theme.node.panel }} onClick={onConfirmPrompt}>
                        <Check className="size-4" />
                        确认并准备视频节点
                    </button>
                </div>
            </GuideShell>
        );
    }

    if (!question) {
        return (
            <GuideShell theme={theme} style={cardStyle}>
                <GuideHeader theme={theme} eyebrow="选择完成" title="需求已经齐了" hint="现在交给 Agent，一次生成当前模型真正能执行的提示词。" />
                <div className="mt-3 rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {agentVideoBriefSummary(brief)}
                </div>
                <button type="button" disabled={busy} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45" style={{ background: theme.toolbar.activeText, color: theme.node.panel }} onClick={onGeneratePrompt}>
                    <Sparkles className="size-4" />
                    让 Agent 生成提示词
                </button>
            </GuideShell>
        );
    }

    return (
        <GuideShell theme={theme} style={cardStyle}>
            <GuideHeader theme={theme} eyebrow={`${question.step} / ${question.total}`} title={question.title} hint={question.hint} />
            {question.key === "creatorNodeId" ? (
                creatorCandidates.length ? (
                    <div className="thin-scrollbar mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
                        {creatorCandidates.map((node) => (
                            <button key={node.id} type="button" className="group overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5" style={{ borderColor: theme.node.stroke, background: theme.node.panel }} onClick={() => onChoose({ creatorNodeId: node.id }, node.title || "人物参考图")}>
                                <div className="aspect-[4/3] overflow-hidden" style={{ background: theme.node.fill }}>
                                    <img src={node.metadata?.content || ""} alt={node.title || "人物参考图"} className="size-full object-cover transition duration-200 group-hover:scale-[1.03]" />
                                </div>
                                <div className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium">
                                    <UserRound className="size-3.5 shrink-0" />
                                    <span className="truncate">{node.title || "人物参考图"}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="mt-3 rounded-xl border border-dashed px-4 py-5 text-center" style={{ borderColor: theme.node.stroke }}>
                        <UserRound className="mx-auto size-5" style={{ color: theme.node.muted }} />
                        <div className="mt-2 text-sm font-medium">画布中还没有可选人物图</div>
                        <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>先添加一张人物图片，回来后会自动出现在这里。</div>
                    </div>
                )
            ) : (
                <div className={`mt-3 grid gap-2 ${question.key === "model" || question.key === "sellingPoint" ? "grid-cols-1" : "grid-cols-2"}`}>
                    {question.options.map((option) => (
                        <button key={`${question.key}-${option.label}`} type="button" className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:-translate-y-0.5" style={{ borderColor: theme.node.stroke, background: theme.node.panel }} onClick={() => onChoose(option.patch, option.label)}>
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold leading-5">{option.label}</span>
                                {option.description ? <span className="mt-0.5 block text-[11px] leading-4" style={{ color: theme.node.muted }}>{option.description}</span> : null}
                            </span>
                            <ChevronRight className="size-4 shrink-0 opacity-35 transition group-hover:translate-x-0.5 group-hover:opacity-80" />
                        </button>
                    ))}
                </div>
            )}
            {product ? (
                <div className="mt-3 flex items-center gap-2 border-t pt-3 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <Video className="size-3.5" />
                    <span className="truncate">产品已锁定：{product.title || "当前产品图"}</span>
                </div>
            ) : null}
        </GuideShell>
    );
}

function GuideShell({ children, style, theme }: { children: ReactNode; style: CSSProperties; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="rounded-2xl border p-4 shadow-sm" style={{ ...style, boxShadow: `0 12px 32px ${theme.canvas.selectionFill}` }}>
            {children}
        </div>
    );
}

function GuideHeader({ eyebrow, title, hint, theme }: { eyebrow: string; title: string; hint: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                <Video className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.node.faint }}>{eyebrow}</div>
                <div className="mt-0.5 text-sm font-semibold leading-5">{title}</div>
                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{hint}</div>
            </div>
        </div>
    );
}
