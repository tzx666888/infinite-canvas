"use client";

import { Bot, Copy, FolderPlus, WandSparkles } from "lucide-react";
import { Button, Modal, Space, Tag } from "antd";

import { cn } from "@/lib/utils";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { PromptCover } from "./prompt-cover";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const createdAt = prompt ? formatPromptDate(prompt.createdAt) : "";
    const updatedAt = prompt ? formatPromptDate(prompt.updatedAt) : "";
    const dateText = [createdAt ? `创建：${createdAt}` : "", updatedAt ? `更新：${updatedAt}` : ""].filter(Boolean).join(" · ");
    const hasVisual = Boolean(prompt?.coverUrl.trim() || prompt?.visual || (prompt?.preview.trim() && prompt.origin !== "tokaxis"));

    return (
        <>
            <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={860}>
                {prompt ? (
                    <>
                        <div className={cn("grid gap-5", hasVisual ? "md:grid-cols-[300px_minmax(0,1fr)]" : "")}>
                            {hasVisual ? (
                                <div className="space-y-3">
                                    {prompt.coverUrl.trim() || prompt.visual ? (
                                        <PromptCover coverUrl={prompt.coverUrl} title={prompt.title} visual={prompt.origin === "tokaxis" ? prompt.visual : undefined} action={prompt.action} media={prompt.media} className="rounded-lg" />
                                    ) : null}
                                    {prompt.preview && prompt.origin !== "tokaxis" ? (
                                        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className="min-w-0">
                                {prompt.origin === "tokaxis" ? (
                                    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-700 dark:text-cyan-300">
                                        {prompt.action === "agent_workflow" ? <Bot className="size-3.5" /> : <WandSparkles className="size-3.5" />}
                                        {prompt.action === "agent_workflow" ? "Tokaxis Agent 工作流" : prompt.media === "video" ? "Tokaxis 通用视频提示词" : "Tokaxis 生成提示词"}
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap gap-1.5">
                                    {prompt.tags.map((tag) => (
                                        <Tag key={tag} className="m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                                {prompt.summary ? <p className="mt-4 text-sm font-medium leading-6 text-stone-950 dark:text-stone-100">{prompt.summary}</p> : null}
                                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                                {dateText ? <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">{dateText}</div> : null}
                                <Space wrap className="mt-5">
                                    <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                        {prompt.action === "agent_workflow" ? "复制启动指令" : "复制提示词"}
                                    </Button>
                                    {onSaveAsset && prompt.action !== "agent_workflow" ? (
                                        <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                            加入我的素材
                                        </Button>
                                    ) : null}
                                </Space>
                            </div>
                        </div>
                    </>
                ) : null}
            </Modal>
        </>
    );
}
