import type { NextRequest } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

type PromptCategory = {
    category: string;
    githubUrl: string;
    build: () => Promise<Omit<Prompt, "category" | "githubUrl">[]>;
};

const gptImage2RawBase = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main";
const awesomeGptImageRawBase = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main";
const awesomeGpt4oImagePromptsBase = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main";
const youMindGptImage2RawBase = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main";
const youMindNanoBananaProRawBase = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main";
const davidWuGptImage2RawBase = "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main";
const gptImage2CaseFiles = ["README.md", "cases/ad-creative.md", "cases/character.md", "cases/comparison.md", "cases/ecommerce.md", "cases/portrait.md", "cases/poster.md", "cases/ui.md"];
const cacheTtlMs = 1000 * 60 * 60;
const promptCacheRoot = process.env.PROMPT_CACHE_DIR || join(tmpdir(), "infinite-canvas-prompt-cache");
const promptLibraryCacheDir = process.env.PROMPT_LIBRARY_CACHE_DIR || promptCacheRoot;
const promptLibraryCacheFile = join(promptLibraryCacheDir, "prompt-library-v3.json");

const sourceCategories: PromptCategory[] = [
    { category: "gpt-image-2-prompts", githubUrl: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", build: buildGptImage2Prompts },
    { category: "awesome-gpt-image", githubUrl: "https://github.com/ZeroLu/awesome-gpt-image", build: buildAwesomeGptImagePrompts },
    { category: "awesome-gpt4o-image-prompts", githubUrl: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", build: buildAwesomeGpt4oImagePrompts },
    { category: "youmind-gpt-image-2", githubUrl: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", build: () => buildYouMindPrompts(youMindGptImage2RawBase, "youmind-gpt-image-2", "gpt-image-2") },
    { category: "youmind-nano-banana-pro", githubUrl: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", build: () => buildYouMindPrompts(youMindNanoBananaProRawBase, "youmind-nano-banana-pro", "nano-banana-pro") },
    { category: "davidwu-gpt-image2-prompts", githubUrl: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts", build: buildDavidWuGptImage2Prompts },
];

const curatedTags = ["商品图", "电商海报", "广告创意", "人物肖像", "场景图", "摄影写实", "插画动漫", "界面设计", "文字排版", "建筑空间", "游戏娱乐", "信息图表", "短视频", "品牌包装", "需要参考图"] as const;
const curatedCategories = ["精选案例", "商品电商", "人像摄影", "设计排版", "场景空间", "视频创意", "游戏娱乐"] as const;
const curatedTagSet = new Set<string>(curatedTags);
const internalTagPattern = /^(?:@|#)|老板原创|internal|author|source|github|twitter|x\.com|open-design|原创$|other$/i;
const riskyPromptPattern =
    /特朗普|川普|\btrump\b|奥特曼|ultraman|iphone|apple\s+park|elon\s*musk|马斯克|\bgta\b|grand\s+theft\s+auto|英雄联盟|league\s+of\s+legends|黑神话|悟空|harry\s+potter|disney|marvel|pokemon|pokémon|naruto|one\s+piece|杀手|hitman|塞尔达|zelda|林克|刘亦菲|tiktok|抖音|youtube|openai\s*总部|gpt-6/i;

let memoryCache: { items: Prompt[]; fetchedAt: number } | null = null;
let loadingPrompts: Promise<Prompt[]> | null = null;

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const keyword = (params.get("keyword") || "").trim().toLowerCase();
    const tags = params.getAll("tag").filter(Boolean);
    const category = params.get("category") || "";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize")) || 20));
    const items = await getPrompts();
    const withoutTagFilter = filterPrompts(items, { keyword, category, tags: [] });
    const filtered = filterPrompts(items, { keyword, category, tags });

    return Response.json({
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        tags: collectTags(withoutTagFilter),
        categories: collectCategories(items),
        total: filtered.length,
    });
}

async function getPrompts() {
    if (memoryCache && Date.now() - memoryCache.fetchedAt < cacheTtlMs) return memoryCache.items;
    if (loadingPrompts) return loadingPrompts;
    loadingPrompts = loadPrompts().finally(() => {
        loadingPrompts = null;
    });
    return loadingPrompts;
}

async function loadPrompts() {
    const diskCache = await readPromptLibraryCache();
    const settled = await Promise.all(
        sourceCategories.map(async (category) => {
            try {
                const items = await category.build();
                return { failed: false, items: items.map((item) => ({ ...item, category: category.category, githubUrl: category.githubUrl })) };
            } catch {
                return { failed: true, items: [] as Prompt[] };
            }
        }),
    );
    const items = sanitizePrompts(settled.flatMap((result) => result.items));
    const failedCount = settled.filter((result) => result.failed).length;
    if (diskCache?.items.length && shouldUsePromptDiskCache(items, diskCache.items, failedCount)) {
        const cachedItems = sanitizePrompts(diskCache.items);
        memoryCache = { items: cachedItems, fetchedAt: Date.now() };
        return cachedItems;
    }
    if (items.length) await writePromptLibraryCache(items);
    memoryCache = { items, fetchedAt: Date.now() };
    return items;
}

async function readPromptLibraryCache() {
    try {
        const raw = await readFile(promptLibraryCacheFile, "utf8");
        const parsed = JSON.parse(raw) as { items?: Prompt[]; fetchedAt?: number };
        return Array.isArray(parsed.items) ? { items: parsed.items, fetchedAt: Number(parsed.fetchedAt) || 0 } : null;
    } catch {
        return null;
    }
}

async function writePromptLibraryCache(items: Prompt[]) {
    try {
        await mkdir(promptLibraryCacheDir, { recursive: true });
        await writeFile(promptLibraryCacheFile, JSON.stringify({ items, fetchedAt: Date.now() }));
    } catch {
        // The memory cache is still useful if the disk cache cannot be written.
    }
}

function shouldUsePromptDiskCache(items: Prompt[], cachedItems: Prompt[], failedCount: number) {
    if (!items.length) return true;
    if (failedCount > 0 && items.length < cachedItems.length) return true;
    return cachedItems.length >= 100 && items.length < cachedItems.length * 0.85;
}

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function sanitizePrompts(items: Prompt[]) {
    return items.map((item) => sanitizePrompt(item)).filter((item): item is Prompt => Boolean(item));
}

function sanitizePrompt(item: Prompt): Prompt | null {
    if (!isPromptSafe(item)) return null;
    const tags = sanitizePromptTags(item);
    return {
        ...item,
        tags,
        category: categoryFromTags(tags),
    };
}

function isPromptSafe(item: Prompt) {
    return !riskyPromptPattern.test([item.title, item.prompt, item.category, ...item.tags].join("\n"));
}

function sanitizePromptTags(item: Pick<Prompt, "title" | "prompt" | "tags" | "category">) {
    const sourceText = [item.title, item.prompt, item.category, ...item.tags.filter((tag) => !internalTagPattern.test(tag))].join(" ").toLowerCase();
    const tags: string[] = [];
    const add = (tag: (typeof curatedTags)[number], pattern?: RegExp) => {
        if (!pattern || pattern.test(sourceText)) tags.push(tag);
    };

    add("商品图", /商品|产品|product|ecommerce|e-commerce|电商|detail|展示|cleaner|bottle|packshot|packaging|package/);
    add("电商海报", /海报|poster|banner|主图|广告图|product_poster|social_post/);
    add("广告创意", /广告|ad\b|advertis|creative|campaign|营销|促销|卖点|brand/);
    add("人物肖像", /人物|人像|头像|portrait|character|profile|face|model|写真|自拍/);
    add("场景图", /场景|scene|环境|空间|室内|家居|厨房|城市|landscape|background/);
    add("摄影写实", /摄影|照片|photo|photography|realistic|写实|raw|camera|cinematic/);
    add("插画动漫", /插画|动漫|anime|illustration|漫画|cartoon|二次元/);
    add("界面设计", /ui|界面|app|dashboard|landing|web|website|screen/);
    add("文字排版", /文字|排版|typography|font|logo|text|letter|字体/);
    add("建筑空间", /建筑|architecture|空间|interior|room|house|building/);
    add("游戏娱乐", /游戏|game|娱乐|sci[-_ ]?fi|fantasy|vfx/);
    add("信息图表", /信息图|infographic|diagram|chart|map|表格|流程|slide|slides|document/);
    add("短视频", /视频|短视频|short_video|animation|dance|cinematic|story|film/);
    add("品牌包装", /品牌|logo|包装|package|packaging|label|card/);
    add("需要参考图", /需要参考图|reference|ref\b|参考图/);

    const uniqueTags = Array.from(new Set(tags)).filter((tag) => curatedTagSet.has(tag));
    return uniqueTags.length ? uniqueTags.slice(0, 4) : ["广告创意"];
}

function categoryFromTags(tags: string[]) {
    if (tags.some((tag) => tag === "短视频")) return "视频创意";
    if (tags.some((tag) => ["商品图", "电商海报", "广告创意", "品牌包装"].includes(tag))) return "商品电商";
    if (tags.some((tag) => tag === "人物肖像")) return "人像摄影";
    if (tags.some((tag) => ["界面设计", "文字排版", "信息图表"].includes(tag))) return "设计排版";
    if (tags.some((tag) => ["建筑空间", "场景图", "摄影写实"].includes(tag))) return "场景空间";
    if (tags.some((tag) => tag === "游戏娱乐")) return "游戏娱乐";
    return "精选案例";
}

async function buildGptImage2Prompts() {
    const data = (await fetchJson<{ records?: Array<{ title?: string; tweet_url?: string; image_dir?: string; category?: string; added_at?: string }> }>(gptImage2RawBase, "data/ingested_tweets.json")).records || [];
    const cases = new Map<string, string>();
    const markdowns = await Promise.all(gptImage2CaseFiles.map((file) => fetchText(gptImage2RawBase, file)));
    markdowns.forEach((markdown) => collectGptImage2Cases(cases, markdown));
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    data.forEach((item) => {
        const prompt = cases.get(item.tweet_url || "");
        if (!item.title || !prompt || !item.image_dir) return;
        const image = `${gptImage2RawBase}/${item.image_dir}/output.jpg`;
        items.push({
            id: `gpt-image-2-prompts-${leftPad(items.length + 1)}`,
            title: item.title,
            coverUrl: image,
            prompt,
            tags: tagsFromCategory(item.category || ""),
            preview: markdownPreview([image]),
            createdAt: item.added_at || "",
            updatedAt: item.added_at || "",
        });
    });
    return items;
}

function collectGptImage2Cases(cases: Map<string, string>, markdown: string) {
    for (const match of markdown.matchAll(/### Case \d+: \[[^\]]+]\(([^)]+)\)[\s\S]*?\*\*Prompt:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/g)) {
        cases.set(match[1], match[2].trim());
    }
}

async function buildAwesomeGptImagePrompts() {
    const markdown = await fetchText(awesomeGptImageRawBase, "README.zh-CN.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const section of splitBeforeHeading(markdown, "## ")) {
        const tags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
        for (const block of splitBeforeHeading(section, "### ")) {
            const title = firstMatch(block, /^###\s+(.+)$/m)
                .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
                .trim();
            const prompt = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/).trim();
            if (!title || !prompt) continue;
            const images = extractMarkdownImages(awesomeGptImageRawBase, block);
            items.push(defaultPrompt(`awesome-gpt-image-${leftPad(items.length + 1)}`, title, prompt, images[0] || "", tags, markdownPreview(images)));
        }
    }
    return items;
}

async function buildAwesomeGpt4oImagePrompts() {
    const markdown = await fetchText(awesomeGpt4oImagePromptsBase, "README.zh-CN.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+(.+)$/m).trim();
        const prompt = firstMatch(block, /- \*\*提示词文本：\*\*\s*`([\s\S]*?)`/).trim();
        if (!title || !prompt) continue;
        const images = extractMarkdownImages(awesomeGpt4oImagePromptsBase, block);
        items.push(defaultPrompt(`awesome-gpt4o-image-prompts-${leftPad(items.length + 1)}`, title, prompt, images[0] || "", ["gpt4o"], markdownPreview(images)));
    }
    return items;
}

async function buildYouMindPrompts(baseUrl: string, idPrefix: string, modelTag: string) {
    const markdown = await fetchText(baseUrl, "README_zh.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
        const prompt = firstMatch(block, /#### [\s\S]*?提示词\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/).trim();
        if (!title || !prompt) continue;
        const images = extractMarkdownImages(baseUrl, block);
        items.push(defaultPrompt(`${idPrefix}-${leftPad(items.length + 1)}`, title, prompt, images[0] || "", youMindTags(title, modelTag), markdownPreview(images)));
    }
    return items;
}

async function buildDavidWuGptImage2Prompts() {
    const data = await fetchJson<Array<{ id?: number; title_en?: string; title_cn?: string; category?: string; category_cn?: string; prompt?: string; note?: string; author?: string; source?: string; needs_ref?: boolean; image?: string }>>(
        davidWuGptImage2RawBase,
        "prompts.json",
    );
    return data
        .map((item, index) => {
            const title = (item.title_cn || item.title_en || "").trim();
            const prompt = (item.prompt || "").trim();
            if (!title || !prompt) return null;
            const image = absoluteImage(davidWuGptImage2RawBase, item.image || "");
            const preview = [item.title_en, item.note, image ? `![](${image})` : ""].filter(Boolean).join("\n\n");
            return defaultPrompt(`davidwu-gpt-image2-prompts-${leftPad(item.id || index + 1)}`, title, prompt, image, davidWuTags(item), preview);
        })
        .filter((item): item is Omit<Prompt, "category" | "githubUrl"> => Boolean(item));
}

function defaultPrompt(id: string, title: string, prompt: string, coverUrl: string, tags: string[], preview: string): Omit<Prompt, "category" | "githubUrl"> {
    return { id, title, coverUrl, prompt, tags, preview, createdAt: "", updatedAt: "" };
}

async function fetchText(baseUrl: string, file: string) {
    const response = await fetch(`${baseUrl}/${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${file} 拉取失败`);
    return response.text();
}

async function fetchJson<T>(baseUrl: string, file: string) {
    return JSON.parse(await fetchText(baseUrl, file)) as T;
}

function splitBeforeHeading(markdown: string, prefix: string) {
    const blocks: string[] = [];
    let current: string[] = [];
    for (const line of markdown.split("\n")) {
        if (line.startsWith(prefix) && current.length) {
            blocks.push(current.join("\n"));
            current = [];
        }
        current.push(line);
    }
    blocks.push(current.join("\n"));
    return blocks;
}

function firstMatch(value: string, pattern: RegExp) {
    return pattern.exec(value)?.[1] || "";
}

function extractMarkdownImages(baseUrl: string, markdown: string) {
    return Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), (match) => absoluteImage(baseUrl, match[1] || match[2] || "")).filter(Boolean);
}

function absoluteImage(baseUrl: string, image: string) {
    if (!image) return "";
    const value = image.trim();
    if (/^https?:\/\/img\.shields\.io\//i.test(value)) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return `${baseUrl}/${value.replace(/^\.?\//, "")}`;
}

function tagsFromCategory(category: string) {
    return splitTags(category.replace(/\s+Cases$/i, ""), /\s*(?:&|and)\s*/);
}

function tagsFromHeading(heading: string) {
    return splitTags(heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, ""), /\s*(?:\/|&|、|与)\s*/);
}

function youMindTags(title: string, modelTag: string) {
    const [, prefix] = title.match(/^(.+?) - /) || [];
    return [modelTag, ...tagsFromHeading(prefix || "")];
}

function davidWuTags(item: { category_cn?: string; category?: string; author?: string; source?: string; needs_ref?: boolean }) {
    const tags = splitTags([item.category_cn, item.category, item.author, item.source].filter(Boolean).join("/"), /\//);
    if (item.needs_ref) tags.push("需要参考图");
    return tags;
}

function splitTags(value: string, pattern: RegExp) {
    return value
        .split(pattern)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
}

function markdownPreview(images: string[]) {
    return images
        .filter(Boolean)
        .map((image) => `![](${image})`)
        .join("\n\n");
}

function collectTags(items: Prompt[]) {
    const available = new Set(items.flatMap((item) => item.tags).filter(Boolean));
    return curatedTags.filter((tag) => available.has(tag));
}

function collectCategories(items: Prompt[]) {
    const available = new Set(items.map((item) => item.category).filter(Boolean));
    return curatedCategories.filter((category) => available.has(category));
}

function leftPad(value: number) {
    return String(value).padStart(4, "0");
}

function isActiveOption(value: string) {
    return value && value !== "全部" && value !== "all";
}
