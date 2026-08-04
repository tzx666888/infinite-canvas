"use client";

import { Bot, Copy, WandSparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card, Tag } from "antd";

import { cn } from "@/lib/utils";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { PromptCover } from "./prompt-cover";

export function PromptCard({
    item,
    onOpen,
    onCopy,
    actionLabel = "复制",
    actionIcon = <Copy className="size-3.5" />,
    actionType = "text",
    extraAction,
}: {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
}) {
    const isTokaxis = item.origin === "tokaxis";
    const hasCover = Boolean(item.coverUrl.trim() || item.visual);
    const date = formatPromptDate(item.updatedAt);

    return (
        <Card
            hoverable
            className={cn("group overflow-hidden", isTokaxis && "border-cyan-400/25 bg-gradient-to-b from-cyan-400/[0.035] to-transparent")}
            styles={{ body: { padding: 0 } }}
            cover={
                hasCover ? (
                    <div
                        role="button"
                        tabIndex={0}
                        className="block w-full cursor-pointer text-left"
                        onClick={onOpen}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            onOpen();
                        }}
                    >
                        <PromptCover coverUrl={item.coverUrl} title={item.title} visual={isTokaxis ? item.visual : undefined} action={item.action} media={item.media} />
                    </div>
                ) : undefined
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2>
                        {isTokaxis ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold tracking-[0.14em] text-cyan-700 dark:text-cyan-300">TOKAXIS</span>
                        ) : date ? (
                            <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{date}</span>
                        ) : null}
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{item.summary || item.prompt}</p>
                    {isTokaxis ? (
                        <div className="mt-3 flex items-center gap-1.5 text-[10px] font-medium text-stone-500 dark:text-stone-400">
                            {item.action === "agent_workflow" ? <Bot className="size-3.5 text-violet-500" /> : <WandSparkles className="size-3.5 text-cyan-500" />}
                            <span>{item.action === "agent_workflow" ? "Agent 工作流 · 填入后确认发送" : item.media === "video" ? "视频管线 · 自动适配当前模型" : "生成提示词 · 可继续编辑"}</span>
                        </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.tags.slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>
                    {actionLabel}
                </Button>
                {extraAction}
            </div>
        </Card>
    );
}
