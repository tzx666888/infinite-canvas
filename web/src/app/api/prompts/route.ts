import type { NextRequest } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOKAXIS_PROMPTS, type Prompt, type PromptAction, type PromptIntent, type PromptMedia, type PromptVisual } from "@/lib/tokaxis-prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExternalPrompt = Omit<Prompt, "origin" | "intent" | "action" | "visual" | "summary" | "media">;

type PromptCategory = {
    category: string;
    githubUrl: string;
    build: () => Promise<Omit<ExternalPrompt, "category" | "githubUrl">[]>;
};

type ScoredRule = { id: string; score: number; pattern: RegExp };
type ExternalPromptMetadata = { origin: "community"; intent: PromptIntent; action: "insert_prompt"; visual: PromptVisual; media: PromptMedia };

const gptImage2RawBase = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main";
const awesomeGptImageRawBase = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main";
const awesomeGpt4oImagePromptsBase = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main";
const youMindGptImage2RawBase = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main";
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
    { category: "davidwu-gpt-image2-prompts", githubUrl: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts", build: buildDavidWuGptImage2Prompts },
];

const curatedTags = ["商品图", "电商海报", "广告创意", "人物肖像", "场景图", "摄影写实", "文字排版", "短视频", "品牌包装", "需要参考图"] as const;
const curatedCategories = ["Tokaxis 创作", "商品电商", "商业人物"] as const;
const curatedTagSet = new Set<string>(curatedTags);
const internalTagPattern = /^(?:@|#)|老板原创|internal|author|source|github|twitter|x\.com|open-design|原创$|other$/i;
const riskyPromptPattern =
    /特朗普|川普|\btrump\b|奥特曼|ultraman|iphone|apple\s+park|elon\s*musk|马斯克|\bgta\b|grand\s+theft\s+auto|英雄联盟|league\s+of\s+legends|黑神话|悟空|harry\s+potter|disney|marvel|pokemon|pokémon|naruto|one\s+piece|杀手|hitman|塞尔达|zelda|林克|刘亦菲|tiktok|抖音|youtube|openai\s*总部|gpt-6/i;
const externalWhitelistRules = {
    product: [
        { id: "explicit-commerce-product", score: 6, pattern: /电商|商品(?:图|摄影|展示|主图|详情)|产品(?:图|摄影|展示|主图|海报|广告|包装)|\be-?commerce\b|packshot|product[-_ ]?(?:photo|shot|poster|display)/i },
        {
            id: "retail-product-or-packaging",
            score: 4,
            pattern: /包装|美妆|护肤|化妆品|服装|鞋履|珠宝|手表|食品|饮料|瓶身|箱包|家具|香水|packag(?:e|ing)|cosmetic|skincare|apparel|jewelry|watch|beverage|bottle|handbag|furniture|perfume|sneaker|shoe|consumer goods/i,
        },
    ],
    commerce: [
        { id: "brand-advertising", score: 4, pattern: /广告|品牌|营销|促销|卖点|主视觉|商业(?:摄影|广告|人像|产品|海报)|advertis|brand(?:ing)?|marketing|campaign|promotion|catalog|retail|hero image|social[-_ ]?(?:media[-_ ]?)?ad/i },
        { id: "sales-layout", score: 4, pattern: /销售|转化|上新|详情页|商业海报|sale(?:s)?|conversion|launch campaign|product page|storefront|merchandis/i },
    ],
    person: [{ id: "adult-portrait-subject", score: 2, pattern: /真人|成年人|人像|肖像|写真|模特|代言人|portrait|headshot|spokesperson|\badult\b|\bmodel\b/i }],
    commercialPerson: [{ id: "commercial-person-context", score: 4, pattern: /商业人像|职业照|品牌代言|时尚大片|美容广告|fashion editorial|beauty campaign|business headshot|corporate portrait|lifestyle campaign|lookbook|editorial portrait/i }],
    scene: [{ id: "supporting-commercial-scene", score: 1, pattern: /场景|环境|家居|厨房|商店|摄影棚|scene|environment|lifestyle|kitchen|retail space|studio set|background/i }],
    layout: [{ id: "supporting-commercial-layout", score: 1, pattern: /海报|横幅|排版|社交媒体|信息图|poster|banner|typography|layout|social post|infographic|comparison chart/i }],
    video: [{ id: "commercial-motion-format", score: 2, pattern: /短视频|广告片|宣传片|分镜|镜头|运镜|short[-_ ]?video|promo(?:tional)? film|storyboard|shot list|camera move|\breel\b/i }],
    photography: [{ id: "commercial-image-format", score: 1, pattern: /摄影|写实|棚拍|布光|photo(?:graphy)?|realistic|camera|lighting|studio shot/i }],
} satisfies Record<string, ScoredRule[]>;
const externalHardExclusionPatterns = [
    { id: "game-entertainment", pattern: /游戏|电竞|街机|二次元|动漫|漫画|q\s*版|卡通|video game|gaming|game art|arcade|\brpg\b|\bmoba\b|cosplay|anime|cartoon|comic|chibi|fantasy character|superhero/i },
    { id: "ui-interface", pattern: /界面|交互设计|移动端\s*ui|ui\s*(?:与|&|\/)?\s*界面|ui\s*\/\s*ux|user interface|dashboard|app (?:screen|homepage|interface)|website design/i },
    { id: "information-diagram", pattern: /信息图|关系图|教育视觉|数据可视化|流程图|infographic|data visualization|flowchart|relationship (?:map|diagram)|\bdiagram\b|\bchart\b/i },
    { id: "architecture-only", pattern: /建筑|城市规划|室内设计|architecture|building facade|urban planning|floor plan|interior design/i },
    { id: "external-video-module", pattern: /视频模板|电影叙事|特效\s*\/\s*奇幻|舞蹈\s*\/\s*动作|video template|storyboard|shot list/i },
    { id: "generic-lifestyle-snapshot", pattern: /生活切片|街头多人合影|真实路人|documentary street|street snapshot|candid group photo/i },
    { id: "generic-genre-scene", pattern: /赛博朋克|旅游推广|地标建筑|cyberpunk|travel (?:poster|promotion)|tourism promotion|iconic landmarks/i },
];
const externalSupportingOnlyPatterns = [
    { id: "architecture", pattern: /建筑|城市规划|室内设计|architecture|building facade|urban planning|floor plan|interior design/i },
    { id: "interface", pattern: /界面|交互设计|ui\s*\/\s*ux|user interface|dashboard|app screen|website design/i },
    { id: "noncommercial-information", pattern: /信息图|数据可视化|流程图|infographic|data visualization|flowchart|diagram|\bchart\b/i },
];
const tokaxisPromptIds = new Set(TOKAXIS_PROMPTS.map((item) => item.id));
const externalPromptIdPattern = /^(?:gpt-image-2-prompts|awesome-gpt-image|awesome-gpt4o-image-prompts|youmind-gpt-image-2|davidwu-gpt-image2-prompts)-/;

let memoryCache: { items: Prompt[]; fetchedAt: number } | null = null;
let loadingPrompts: Promise<Prompt[]> | null = null;

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const keyword = (params.get("keyword") || "").trim().toLowerCase();
    const tags = params.getAll("tag").filter(Boolean);
    const category = params.get("category") || "";
    const action = promptAction(params.get("action"));
    const media = promptMedia(params.get("media"));
    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize")) || 20));
    const items = await getPrompts();
    const withoutTagFilter = filterPrompts(items, { keyword, category, action, media, tags: [] });
    const filtered = filterPrompts(items, { keyword, category, action, media, tags });
    const scopeItems = filterPrompts(items, { keyword: "", category: "", action, media, tags: [] });

    return Response.json({
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        tags: collectTags(withoutTagFilter),
        categories: collectCategories(scopeItems),
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
                return { failed: true, items: [] as ExternalPrompt[] };
            }
        }),
    );
    const freshItems = sanitizeExternalPrompts(settled.flatMap((result) => result.items));
    const cachedItems = diskCache?.items.length ? sanitizeExternalPrompts(diskCache.items.filter((item) => !tokaxisPromptIds.has(item.id) && externalPromptIdPattern.test(item.id))) : null;
    const failedCount = settled.filter((result) => result.failed).length;
    const useCachedItems = Boolean(cachedItems && shouldUsePromptDiskCache(freshItems, cachedItems, failedCount));
    const items = composePromptLibrary(useCachedItems ? cachedItems || [] : freshItems);
    if (!useCachedItems && freshItems.length) await writePromptLibraryCache(items);
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

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; action: PromptAction | ""; media: PromptMedia | ""; tags: string[] }) {
    return items.filter((item) => {
        if (options.action && item.action !== options.action) return false;
        if (options.media && item.media !== options.media) return false;
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.summary, item.prompt, item.category, item.intent, ...item.tags].filter(Boolean).join(" ").toLowerCase().includes(options.keyword);
    });
}

function sanitizeExternalPrompts(items: ExternalPrompt[]) {
    return items.flatMap((item) => {
        const metadata = classifyExternalPrompt(item);
        if (!metadata) return [];
        const sanitized = sanitizePrompt({ ...item, ...metadata });
        return sanitized ? [{ ...sanitized, category: metadata.intent === "commercial_portrait" ? "商业人物" : "商品电商" }] : [];
    });
}

function composePromptLibrary(items: Prompt[]) {
    return [...TOKAXIS_PROMPTS, ...items.filter((item) => !tokaxisPromptIds.has(item.id))];
}

function classifyExternalPrompt(item: ExternalPrompt): ExternalPromptMetadata | null {
    // Cached category/tags may contain classifications produced by older, broader rules.
    // Only the title and prompt body are authoritative when deciding whether an item is commercial.
    const sourceText = [item.title, item.prompt].join(" ").toLowerCase();
    if (externalHardExclusionPatterns.some((rule) => rule.pattern.test(sourceText))) return null;

    const scores = {
        product: scoreRules(sourceText, externalWhitelistRules.product),
        commerce: scoreRules(sourceText, externalWhitelistRules.commerce),
        person: scoreRules(sourceText, externalWhitelistRules.person),
        commercialPerson: scoreRules(sourceText, externalWhitelistRules.commercialPerson),
        scene: scoreRules(sourceText, externalWhitelistRules.scene),
        layout: scoreRules(sourceText, externalWhitelistRules.layout),
        video: scoreRules(sourceText, externalWhitelistRules.video),
        photography: scoreRules(sourceText, externalWhitelistRules.photography),
    };
    const supportingScore = scores.scene + scores.layout + scores.video + scores.photography;
    const hasProduct = scores.product >= 6 || (scores.product >= 4 && supportingScore > 0);
    const hasCommercialPerson = scores.person > 0 && (scores.commercialPerson >= 4 || scores.commerce >= 4);
    const hasCommerceFormat = scores.commerce >= 4 && (supportingScore > 0 || scores.person > 0);
    const hasCommercialAnchor = hasProduct || hasCommercialPerson || hasCommerceFormat;
    if (externalSupportingOnlyPatterns.some((rule) => rule.pattern.test(sourceText)) && !hasProduct && !hasCommercialPerson) return null;
    if (!hasCommercialAnchor || Object.values(scores).reduce((total, score) => total + score, 0) < 5) return null;

    let intent: PromptIntent = "still_image";
    let visual: PromptVisual = "image";
    if (hasCommercialPerson) {
        intent = "commercial_portrait";
        visual = "portrait";
    } else if (hasProduct) {
        intent = "commerce_product";
        visual = "product";
    } else if (scores.scene > 0 || scores.layout > 0) {
        intent = "commerce_scene_layout";
    }
    return { origin: "community", intent, action: "insert_prompt", visual, media: "image" };
}

function scoreRules(sourceText: string, rules: ScoredRule[]) {
    return rules.reduce((score, rule) => score + (rule.pattern.test(sourceText) ? rule.score : 0), 0);
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
    add("文字排版", /文字|排版|typography|font|logo|text|letter|字体/);
    add("短视频", /视频|短视频|short_video|animation|dance|cinematic|story|film/);
    add("品牌包装", /品牌|logo|包装|package|packaging|label|card/);
    add("需要参考图", /需要参考图|reference|ref\b|参考图/);

    const uniqueTags = Array.from(new Set(tags)).filter((tag) => curatedTagSet.has(tag));
    return uniqueTags.length ? uniqueTags.slice(0, 4) : ["广告创意"];
}

function categoryFromTags(tags: string[]) {
    if (tags.some((tag) => ["商品图", "电商海报", "广告创意", "品牌包装"].includes(tag))) return "商品电商";
    if (tags.some((tag) => tag === "人物肖像")) return "商业人物";
    return "商品电商";
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

function promptAction(value: string | null): PromptAction | "" {
    return value === "insert_prompt" || value === "agent_workflow" ? value : "";
}

function promptMedia(value: string | null): PromptMedia | "" {
    return value === "text" || value === "image" || value === "video" || value === "mixed" ? value : "";
}

function isActiveOption(value: string) {
    return value && value !== "全部" && value !== "all";
}
