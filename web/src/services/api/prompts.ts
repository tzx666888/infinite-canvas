import { compactApiParams, serializeApiParams } from "@/services/api/request";

import type { Prompt, PromptAction, PromptMedia } from "@/lib/tokaxis-prompts";

export type { Prompt, PromptAction, PromptIntent, PromptMedia, PromptOrigin, PromptVisual } from "@/lib/tokaxis-prompts";

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export async function fetchPrompts({
    keyword = "",
    tag = [],
    category = ALL_PROMPTS_OPTION,
    action,
    media,
    page,
    pageSize,
}: {
    keyword?: string;
    tag?: string[];
    category?: string;
    action?: PromptAction;
    media?: PromptMedia;
    page?: number;
    pageSize?: number;
} = {}) {
    const params = serializeApiParams(
        compactApiParams({
            ...(keyword ? { keyword } : {}),
            ...(tag.length ? { tag } : {}),
            ...(category !== ALL_PROMPTS_OPTION ? { category } : {}),
            ...(action ? { action } : {}),
            ...(media ? { media } : {}),
            ...(page ? { page } : {}),
            ...(pageSize ? { pageSize } : {}),
        }),
    );
    const response = await fetch(`/api/prompts${params.size ? `?${params}` : ""}`);
    if (!response.ok) throw new Error("获取提示词失败");
    return (await response.json()) as PromptListResponse;
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
