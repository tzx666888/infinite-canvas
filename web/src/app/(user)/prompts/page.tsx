"use client";

import { Bot, FolderPlus, Search } from "lucide-react";
import { type UIEvent, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin, Tag } from "antd";

import { PromptCard } from "@/components/prompts/prompt-card";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { useCopyText } from "@/hooks/use-copy-text";
import { useSaveAsset } from "@/hooks/use-save-asset";
import { cn } from "@/lib/utils";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const saveAsset = useSaveAsset();
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory });
    const tokaxisItems = promptItems.filter((item) => item.origin === "tokaxis");
    const communityItems = promptItems.filter((item) => item.origin !== "tokaxis");
    const promptCountLabel = query.isLoading ? "正在加载电商与商业人物提示词。" : `共 ${totalPrompts} 条精选内容，包含 Tokaxis 创作、商品电商与商业人物。`;

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
        }
    }, [message, query.error, query.isError]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const savePromptAsset = (item: Prompt) => {
        saveAsset({
            kind: "text",
            initialCategory: "提示词",
            prepare: () => ({
                asset: {
                    kind: "text",
                    title: item.title,
                    coverUrl: item.coverUrl,
                    tags: item.tags,
                    source: item.category,
                    data: { content: item.prompt },
                    metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl },
                },
            }),
        });
    };

    const copyPrompt = (item: Prompt) => copyText(item.prompt, item.action === "agent_workflow" ? "工作流启动指令已复制" : "提示词已复制");

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) {
            void query.fetchNextPage();
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main
                className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]"
                onScroll={handleListScroll}
            >
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">提示词中心</h1>
                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{promptCountLabel}</p>
                    </div>
                    {query.isLoading ? (
                        <div className="flex h-60 items-center justify-center">
                            <Spin />
                        </div>
                    ) : null}
                    {!query.isLoading ? (
                        <>
                            <div className="mx-auto mt-8 w-full max-w-2xl">
                                <Input size="large" className="w-full" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder="按标题查询" onChange={(event) => setTitleKeyword(event.target.value)} />
                            </div>
                            <div className="mx-auto mt-6 grid max-w-6xl gap-3 text-left">
                                <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                                    <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">分类</div>
                                    <div className="flex flex-wrap gap-2">
                                        {promptCategoryOptions.map((category) => (
                                            <Tag.CheckableTag key={category} checked={selectedCategory === category} className={cn("prompt-filter-tag", selectedCategory === category && "is-active")} onChange={() => setSelectedCategory(category)}>
                                                {category}
                                            </Tag.CheckableTag>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                                    <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">标签</div>
                                    <div className="flex flex-wrap gap-2">
                                        {promptTags.map((tag) => (
                                            <Tag.CheckableTag
                                                key={tag}
                                                checked={tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag)}
                                                className={cn("prompt-filter-tag", (tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag)) && "is-active")}
                                                onChange={() => toggleTag(tag)}
                                            >
                                                {tag}
                                            </Tag.CheckableTag>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : null}
                </div>

                {!query.isLoading ? (
                    <div className="mx-auto max-w-7xl">
                        {tokaxisItems.length ? (
                            <section className="mb-10 overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.11),transparent_35%),linear-gradient(145deg,rgba(8,15,23,.98),rgba(11,18,28,.96))] p-5 shadow-[0_24px_80px_rgba(0,0,0,.16)] sm:p-7">
                                <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                                    <div>
                                        <div className="font-mono text-[10px] font-semibold tracking-[0.24em] text-cyan-300">TOKAXIS / CREATION SYSTEM</div>
                                        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">Tokaxis 创作</h2>
                                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">从商业脚本、人物与产品静帧，到分镜和全视频模型自动适配。工作流会先填入 Agent，由你确认后执行。</p>
                                    </div>
                                    <div className="shrink-0 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-white/50">{tokaxisItems.length} CREATION MODULES</div>
                                </div>
                                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                    {tokaxisItems.map((item) => (
                                        <PromptCard
                                            key={item.id}
                                            item={item}
                                            onOpen={() => setSelectedPrompt(item)}
                                            onCopy={() => copyPrompt(item)}
                                            actionLabel={item.action === "agent_workflow" ? "复制启动指令" : "复制提示词"}
                                            actionIcon={item.action === "agent_workflow" ? <Bot className="size-3.5" /> : undefined}
                                            extraAction={
                                                item.action !== "agent_workflow" ? (
                                                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                                        加入我的素材
                                                    </Button>
                                                ) : undefined
                                            }
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {communityItems.length ? (
                            <section>
                                <div className="mb-5 flex items-end justify-between gap-4">
                                    <div>
                                        <div className="text-xs font-semibold tracking-[0.18em] text-stone-400">CURATED COMMERCE</div>
                                        <h2 className="mt-1 text-xl font-semibold text-stone-950 dark:text-stone-100">电商与商业人物灵感</h2>
                                    </div>
                                    <span className="text-xs text-stone-500 dark:text-stone-400">已移除游戏、纯 UI、纯建筑与无商业主体模板</span>
                                </div>
                                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                    {communityItems.map((item) => (
                                        <PromptCard
                                            key={item.id}
                                            item={item}
                                            onOpen={() => setSelectedPrompt(item)}
                                            onCopy={() => copyPrompt(item)}
                                            extraAction={
                                                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                                    加入我的素材
                                                </Button>
                                            }
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {promptItems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的提示词" className="py-16" /> : null}
                        <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? "加载中..." : query.hasNextPage ? "继续向下滚动加载更多" : promptItems.length > 0 ? "已经到底了" : null}</div>
                    </div>
                ) : null}
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onSaveAsset={savePromptAsset} />
        </div>
    );
}
