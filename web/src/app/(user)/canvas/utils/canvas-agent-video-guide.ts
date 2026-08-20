import { nanoid } from "nanoid";

import { videoAspectRatioForSize, videoModelCapabilityContract } from "@/lib/video-model-settings";
import { hasWorkbenchSpokenScript, VIDEO_WORKBENCH_PROMPT_MARKER } from "@/lib/video-workbench-prompt";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasAgentVideoBrief, type CanvasAgentVideoGuidePhase, type CanvasAgentVideoType, type CanvasNodeData } from "../types";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";
import { availableAgentVideoModels, selectedAgentVideoModel, type AvailableAgentVideoModel } from "./agent-video-models";
import { nodeSizeFromRatio } from "./canvas-node-size";
import { resolveReferenceImageVideoConfig } from "./video-reference-model";

export const AGENT_VIDEO_TYPE_OPTIONS: ReadonlyArray<{ value: CanvasAgentVideoType; label: string; description?: string; needsCreator?: boolean }> = [
    { value: "creator", label: "达人出镜（选参考模特）", description: "带货推荐 · 下一步从画布选择模特图", needsCreator: true },
    { value: "handsfree-demo", label: "手部演示", description: "只出现双手与产品" },
    { value: "product-showcase", label: "纯产品展示", description: "不出现人物" },
    { value: "unboxing", label: "开箱", description: "拆包装并展示产品" },
    { value: "tutorial", label: "教程演示", description: "清楚展示一次用法" },
    { value: "pain-solution", label: "痛点解决", description: "只使用已确认的真实痛点" },
    { value: "testimonial", label: "买家证言", description: "需要人物图", needsCreator: true },
    { value: "brand-film", label: "品牌广告", description: "氛围与品牌质感" },
];

export type PrepareCanvasAgentVideoInput = {
    brief: CanvasAgentVideoBrief;
    prompt: string;
    confirmed: boolean;
};

export type PrepareCanvasAgentVideoResult =
    | { ok: true; videoNodeId: string; prompt: string; brief: CanvasAgentVideoBrief }
    | { ok: false; error: string; errorKind: "invalid_args" | "missing_node_id" | "exec_failed" };

export function agentVideoGuideIntro() {
    return "产品参考图已锁定。接下来每次只需点选一项，不用打字；选完后我会按模型能力生成可直接使用的视频提示词。";
}

export function shouldRestartAgentVideoGuide(brief: CanvasAgentVideoBrief | undefined, phase: CanvasAgentVideoGuidePhase | undefined, text: string) {
    if (!brief?.productNodeId || !isAgentVideoCreationRequest(text)) return false;
    return phase === "prepared" || missingAgentVideoBriefFields(brief).length === 0;
}

export type CanvasAgentVideoGuideOption = {
    label: string;
    description?: string;
    patch: Partial<CanvasAgentVideoBrief>;
};

export type CanvasAgentVideoGuideQuestion = {
    key: "videoType" | "creatorNodeId" | "market" | "platform" | "language" | "size" | "model" | "seconds" | "generateAudio" | "withSubtitle" | "sellingPoint";
    title: string;
    hint: string;
    options: CanvasAgentVideoGuideOption[];
    step: number;
    total: number;
};

const MARKET_OPTIONS = ["菲律宾", "马来西亚", "印度尼西亚", "泰国", "越南", "中国"];
const ENGLISH_MARKETS: Record<string, string> = {
    菲律宾: "the Philippines",
    马来西亚: "Malaysia",
    印度尼西亚: "Indonesia",
    泰国: "Thailand",
    越南: "Vietnam",
    中国: "China",
};
const PLATFORM_OPTIONS: Record<string, string[]> = {
    中国: ["抖音", "快手"],
    default: ["TikTok Shop", "Shopee", "Lazada"],
};
const ENGLISH_PLATFORMS: Record<string, string> = { 抖音: "Douyin", 快手: "Kuaishou" };
const LANGUAGE_OPTIONS: Record<string, string[]> = {
    菲律宾: ["Filipino", "English"],
    马来西亚: ["Bahasa Melayu", "English", "中文"],
    印度尼西亚: ["Bahasa Indonesia"],
    泰国: ["ภาษาไทย"],
    越南: ["Tiếng Việt"],
    中国: ["中文"],
};

export function nextAgentVideoGuideQuestion(config: AiConfig, brief: CanvasAgentVideoBrief): CanvasAgentVideoGuideQuestion | null {
    const needsCreator = agentVideoTypeNeedsCreator(brief.videoType);
    const keys: CanvasAgentVideoGuideQuestion["key"][] = [
        "videoType",
        ...(needsCreator ? (["creatorNodeId"] as const) : []),
        "market",
        "platform",
        "language",
        "size",
        "model",
        "seconds",
        "generateAudio",
        "withSubtitle",
        "sellingPoint",
    ];
    const key = keys.find((item) => brief[item] === undefined || brief[item] === "");
    if (!key) return null;
    const shared = { key, step: keys.indexOf(key) + 1, total: keys.length };
    if (key === "videoType") {
        return {
            ...shared,
            title: "想做哪种视频？",
            hint: "真人带货优先选“达人出镜（选参考模特）”；不想出现人物时再选“纯产品展示”。",
            options: AGENT_VIDEO_TYPE_OPTIONS.map((item) => ({ label: item.label, description: item.description, patch: { videoType: item.value } })),
        };
    }
    if (key === "creatorNodeId") return { ...shared, title: "选择参考模特", hint: "产品图已锁定。请从画布选一张模特图，最终会按模特→产品作为两张参考图。", options: [] };
    if (key === "market") return { ...shared, title: "投放哪个市场？", hint: "市场会决定语言、平台习惯和表达方式。", options: MARKET_OPTIONS.map((value) => ({ label: value, patch: { market: value } })) };
    if (key === "platform") {
        const values = PLATFORM_OPTIONS[brief.market || ""] || PLATFORM_OPTIONS.default;
        return { ...shared, title: "投放到哪个平台？", hint: "只显示当前市场常用的平台。", options: values.map((value) => ({ label: value, patch: { platform: value } })) };
    }
    if (key === "language") {
        const values = LANGUAGE_OPTIONS[brief.market || ""] || ["English"];
        return { ...shared, title: "口播使用什么语言？", hint: "提示词主体仍用英文，只有口播台词使用这里选择的语言。", options: values.map((value) => ({ label: value, patch: { language: value } })) };
    }
    if (key === "size") {
        return {
            ...shared,
            title: "选择画面方向",
            hint: "短视频带货通常优先竖屏，也可以选择横屏。",
            options: [
                { label: "竖屏 9:16", description: "720 × 1280", patch: { size: "720x1280" } },
                { label: "横屏 16:9", description: "1280 × 720", patch: { size: "1280x720" } },
            ],
        };
    }
    const referenceCount = needsCreator ? 2 : 1;
    const catalog = agentVideoCapabilityCatalog(config, brief.size, referenceCount, brief.videoType);
    if (key === "model") {
        return {
            ...shared,
            title: "选择视频模型",
            hint: `已按 ${brief.size === "1280x720" ? "横屏" : "竖屏"}和 ${referenceCount} 张参考图自动筛选。以后新增模型也会从能力表自动出现在这里。`,
            options: catalog.map((item) => ({
                label: item.label,
                description: `${item.durations} · ${item.resolution} · 最多 ${item.referenceImageLimit} 张参考图${item.generatedAudio ? " · 支持声音" : " · 无声"}`,
                patch: { model: item.model },
            })),
        };
    }
    const capability = catalog.find((item) => sameModelSelection(item.model, brief.model || ""));
    if (key === "seconds") {
        const values = capability?.durationOptions.length
            ? capability.durationOptions
            : capability?.durationRange
              ? Array.from({ length: capability.durationRange[1] - capability.durationRange[0] + 1 }, (_, index) => capability.durationRange![0] + index)
              : [];
        return {
            ...shared,
            title: "选择视频时长",
            hint: values.length === 1 ? "该模型时长固定，无需猜测。" : "这里只显示所选模型真实支持的时长。",
            options: values.map((value) => ({ label: `${value} 秒${values.length === 1 ? "（模型固定）" : ""}`, patch: { seconds: value } })),
        };
    }
    if (key === "generateAudio") {
        const supported = Boolean(capability?.generatedAudio);
        return {
            ...shared,
            title: "需要生成声音吗？",
            hint: supported ? "可生成自然环境声与已确认语言的口播。" : "该模型当前不支持生成声音，已自动限制为无声。",
            options: supported
                ? [
                      { label: "开启声音", patch: { generateAudio: true } },
                      { label: "关闭声音", patch: { generateAudio: false } },
                  ]
                : [{ label: "无声（模型限制）", patch: { generateAudio: false } }],
        };
    }
    if (key === "withSubtitle") {
        return {
            ...shared,
            title: "画面内需要字幕吗？",
            hint: brief.generateAudio ? "字幕会跟随口播，一次只显示一行。" : "无声视频不生成字幕。",
            options: brief.generateAudio
                ? [
                      { label: "开启字幕", patch: { withSubtitle: true } },
                      { label: "关闭字幕", patch: { withSubtitle: false } },
                  ]
                : [{ label: "关闭字幕", patch: { withSubtitle: false } }],
        };
    }
    return {
        ...shared,
        title: "这条视频重点展示什么？",
        hint: "不确定就让 Agent 从产品图提炼，避免客户还要打字。",
        options: [
            { label: "Agent 自动提炼", description: "根据产品图选择一个可观察、合规的卖点", patch: { sellingPoint: "根据产品参考图提炼一个可观察、合规的核心卖点" } },
            { label: "外观与质感", patch: { sellingPoint: "突出产品外观、材质与表面质感" } },
            { label: "使用方法", patch: { sellingPoint: "清楚展示一次真实使用方法" } },
            { label: "便携易用", patch: { sellingPoint: "突出便携性与操作便利性" } },
            { label: "真实场景体验", patch: { sellingPoint: "展示产品在真实生活场景中的自然使用体验" } },
        ],
    };
}

export function agentVideoDraftRequest(brief: CanvasAgentVideoBrief) {
    const speechRule = brief.generateAudio
        ? `必须包含且只包含一条能在当前时长内自然说完的 ${brief.language || "当地语言"} 口播，格式严格为 Spoken script: "..."。${brief.withSubtitle ? "字幕必须逐字复用这句口播，不得另写字幕。" : "不要生成画面字幕。"}`
        : "禁止口播、旁白和 Spoken script，不要生成画面字幕。";
    return `快捷选项已全部完成。不要重复提问，也不要修改已选参数。请直接读取当前模型能力，先输出简洁中文需求摘要，再输出一条 45–85 个英文词的连续创作指令，最后等待我确认。提示词只写一个主要场景、最多三个可见节拍，并明确真实产品交互、镜头、光线和参考图身份。${speechRule} 不得写标题、Markdown、时间表或未确认的功效宣称。已选需求：${JSON.stringify(cleanBrief(brief))}`;
}

export function agentVideoConfirmRequest() {
    return "确认使用刚才展示的完整英文提示词。请调用 canvas_prepare_video，confirmed=true；只准备并选中普通视频节点，不要自动生成视频。";
}

type AgentVideoDraftMessage = {
    role?: string;
    text?: unknown;
    detail?: unknown;
};

export function extractAgentVideoDraftPrompt(messages: AgentVideoDraftMessage[]) {
    let draftRequestIndex = -1;
    messages.forEach((message, index) => {
        if (message.role === "user" && messageDetailKind(message.detail) === "video-guide-draft-request") draftRequestIndex = index;
    });
    if (draftRequestIndex < 0) return "";
    const response = messages.slice(draftRequestIndex + 1).find((message) => message.role === "assistant" && typeof message.text === "string" && message.text.trim());
    if (!response || typeof response.text !== "string") return "";
    return normalizeAgentVideoDraftPrompt(response.text);
}

export function agentVideoBriefSummary(brief: CanvasAgentVideoBrief) {
    const type = AGENT_VIDEO_TYPE_OPTIONS.find((item) => item.value === brief.videoType)?.label;
    return [type, brief.market, brief.platform, brief.language, brief.model ? modelOptionName(brief.model) : "", brief.size === "1280x720" ? "横屏" : "竖屏", brief.seconds ? `${brief.seconds} 秒` : "", brief.generateAudio ? "有声" : "无声", brief.withSubtitle ? "有字幕" : "无字幕"].filter(Boolean).join(" · ");
}

export function mergeCanvasAgentVideoBrief(current: CanvasAgentVideoBrief | undefined, patch: Partial<CanvasAgentVideoBrief>) {
    return cleanBrief({
        productNodeId: patch.productNodeId ?? current?.productNodeId,
        creatorNodeId: patch.creatorNodeId ?? current?.creatorNodeId,
        videoType: patch.videoType ?? current?.videoType,
        market: patch.market ?? current?.market,
        platform: patch.platform ?? current?.platform,
        language: patch.language ?? current?.language,
        model: patch.model ?? current?.model,
        seconds: patch.seconds ?? current?.seconds,
        size: patch.size ?? current?.size,
        generateAudio: patch.generateAudio ?? current?.generateAudio,
        withSubtitle: patch.withSubtitle ?? current?.withSubtitle,
        sellingPoint: patch.sellingPoint ?? current?.sellingPoint,
        userIntent: patch.userIntent ?? current?.userIntent,
    });
}

export function agentVideoCapabilityCatalog(config: AiConfig, size = "720x1280", referenceImageCount = 1, videoType?: CanvasAgentVideoType) {
    return availableAgentVideoModels(config, normalizeVideoSize(size), Math.max(1, referenceImageCount))
        .filter((item) => agentVideoPromptProfileSupportsType(item.promptProfile, videoType))
        .map((item) => ({
            model: item.value,
            label: item.label,
            durations: item.durationRange ? `${item.durationRange[0]}-${item.durationRange[1]} 秒` : item.durations.map((value) => `${value} 秒`).join(" / "),
            durationOptions: item.durations,
            durationRange: item.durationRange,
            sizes: item.sizes,
            resolution: item.resolution === "2K" ? "2K" : String(item.resolution) + "p",
            referenceImageLimit: item.referenceImageLimit,
            generatedAudio: item.supportsGeneratedAudio,
            promptProfile: item.promptProfile,
        }));
}

export function agentVideoPromptProfileSupportsType(promptProfile: AvailableAgentVideoModel["promptProfile"], videoType?: CanvasAgentVideoType) {
    return !(agentVideoTypeNeedsCreator(videoType) && promptProfile === "first-last-frame");
}

export function lockPreparedAgentVideoConfig(config: AiConfig, node?: CanvasNodeData): AiConfig {
    const brief = node?.metadata?.agentVideoBrief;
    if (!brief?.model) return config;
    const capability = videoModelCapabilityContract(brief.model);
    return {
        ...config,
        model: brief.model,
        videoModel: brief.model,
        size: brief.size || config.size,
        videoSeconds: brief.seconds ? String(brief.seconds) : config.videoSeconds,
        vquality: node?.metadata?.vquality || capability?.resolution || config.vquality,
        videoGenerateAudio: brief.generateAudio === undefined ? config.videoGenerateAudio : String(brief.generateAudio),
    };
}

export function missingAgentVideoBriefFields(brief: CanvasAgentVideoBrief) {
    const missing: string[] = [];
    if (!brief.productNodeId) missing.push("产品参考图");
    if (!brief.videoType) missing.push("视频类型");
    if (agentVideoTypeNeedsCreator(brief.videoType) && !brief.creatorNodeId) missing.push("人物参考图");
    if (!brief.market) missing.push("目标市场");
    if (!brief.platform) missing.push("投放平台");
    if (!brief.language) missing.push("口播语言");
    if (!brief.size) missing.push("横竖屏");
    if (!brief.model) missing.push("视频模型");
    if (!brief.seconds) missing.push("时长");
    if (brief.generateAudio === undefined) missing.push("声音开关");
    if (brief.withSubtitle === undefined) missing.push("字幕开关");
    if (!brief.sellingPoint) missing.push("核心卖点");
    return missing;
}

function isAgentVideoCreationRequest(text: string) {
    const value = text.trim();
    if (!value || /提示词|脚本|分镜|怎么|为什么|分析/.test(value)) return false;
    return /(?:生成|制作|创建|做|拍|来(?:个|一条)?|帮我).{0,32}(?:带货|商品|营销)?视频|(?:带货|商品|营销).{0,12}视频/.test(value);
}

export function validateAgentVideoReferences(snapshot: CanvasAgentSnapshot, brief: CanvasAgentVideoBrief) {
    if (brief.productNodeId && brief.creatorNodeId && brief.productNodeId === brief.creatorNodeId) return "产品参考图和人物参考图不能是同一张图片。";
    const references = [brief.productNodeId, brief.creatorNodeId].filter((value): value is string => Boolean(value));
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    for (const id of references) {
        const node = nodes.get(id);
        if (!node) return `没有找到图片节点：${id}。`;
        if (node.type !== CanvasNodeType.Image || !node.metadata?.content?.trim()) return `参考图片不可用：${id}。`;
    }
    return "";
}

export function prepareCanvasAgentVideo(config: AiConfig, snapshot: CanvasAgentSnapshot, input: PrepareCanvasAgentVideoInput) {
    if (!input.confirmed) throw new Error("客户尚未确认，不得创建视频节点。");
    const brief = cleanBrief(input.brief);
    const missing = missingAgentVideoBriefFields(brief);
    if (missing.length) throw new Error(`视频需求还缺少：${missing.join("、")}。`);
    const referenceError = validateAgentVideoReferences(snapshot, brief);
    if (referenceError) throw new Error(referenceError);
    if (brief.withSubtitle && !brief.generateAudio) throw new Error("字幕开启时必须同时开启声音；如需静音视频，请关闭字幕。");

    const referenceCount = brief.creatorNodeId ? 2 : 1;
    const size = normalizeVideoSize(brief.size);
    const models = availableAgentVideoModels(config, size, referenceCount);
    const model = selectedAgentVideoModel(models, brief.model || "");
    const capability = models.find((item) => item.value === model);
    if (!capability || !brief.model || !sameModelSelection(model, brief.model)) throw new Error("所选视频模型当前不可用，或不支持这些参考图与画面比例。请重新读取模型能力。");
    const seconds = validateDuration(brief.seconds!, capability);
    if (brief.generateAudio && !capability.supportsGeneratedAudio) throw new Error("所选模型不支持生成声音，请关闭声音后继续。");
    if (referenceCount > capability.referenceImageLimit) throw new Error(`所选模型最多支持 ${capability.referenceImageLimit} 张参考图。`);

    const prompt = compileGuidedVideoPrompt({ ...brief, model, seconds, size }, input.prompt, capability);
    const requestedConfig = {
        ...config,
        model,
        videoModel: model,
        size,
        videoSeconds: String(seconds),
        vquality: capability.resolution,
        videoGenerateAudio: String(Boolean(brief.generateAudio)),
    };
    const resolvedConfig = resolveReferenceImageVideoConfig(requestedConfig, referenceCount);
    const productNode = snapshot.nodes.find((node) => node.id === brief.productNodeId)!;
    const orderedReferenceNodeIds = brief.creatorNodeId ? [brief.creatorNodeId, brief.productNodeId!] : [brief.productNodeId!];
    const videoNodeId = `video-${nanoid()}`;
    const baseSize = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
    const nodeSize = nodeSizeFromRatio(resolvedConfig.size, baseSize.width, baseSize.height) || baseSize;
    const finalBrief = cleanBrief({ ...brief, model: resolvedConfig.videoModel || resolvedConfig.model, seconds: Number(resolvedConfig.videoSeconds), size: normalizeVideoSize(resolvedConfig.size) });
    const templateId = `video-guide:${brief.videoType}`;
    const ops: CanvasAgentOp[] = [
        {
            type: "add_node",
            id: videoNodeId,
            nodeType: CanvasNodeType.Video,
            title: `${agentVideoTypeLabel(brief.videoType)} · ${brief.market}`,
            position: { x: productNode.position.x + productNode.width + 96, y: productNode.position.y },
            width: nodeSize.width,
            height: nodeSize.height,
            metadata: {
                prompt,
                composerContent: prompt,
                promptSourceKind: "agent_generated",
                promptTemplateId: templateId,
                telemetryDraftPrompt: prompt,
                telemetryDraftSourceKind: "agent_generated",
                telemetryDraftTemplateId: templateId,
                generationMode: "video",
                status: "idle",
                model: finalBrief.model,
                size: resolvedConfig.size,
                seconds: resolvedConfig.videoSeconds,
                vquality: resolvedConfig.vquality,
                generateAudio: resolvedConfig.videoGenerateAudio,
                watermark: resolvedConfig.videoWatermark,
                productScaleMode: resolvedConfig.videoProductScaleMode,
                inputOrder: orderedReferenceNodeIds,
                agentVideoReferenceRoles: { productNodeId: brief.productNodeId!, ...(brief.creatorNodeId ? { creatorNodeId: brief.creatorNodeId } : {}) },
                agentVideoBrief: finalBrief,
            },
        },
        ...orderedReferenceNodeIds.map((fromNodeId): CanvasAgentOp => ({ type: "connect_nodes", fromNodeId, toNodeId: videoNodeId })),
        { type: "select_nodes", ids: [videoNodeId] },
    ];
    return { videoNodeId, prompt, brief: finalBrief, ops };
}

function compileGuidedVideoPrompt(brief: CanvasAgentVideoBrief & { model: string; seconds: number; size: "720x1280" | "1280x720" }, direction: string, capability: AvailableAgentVideoModel) {
    const body = direction
        .replace(/^\s*WORKBENCH-DIRECTED VIDEO\.?\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
    if (body.length < 80) throw new Error("视频提示词必须包含主体动作、场景、镜头、光线和产品展示方式，并控制为 45–85 个英文词。");
    if (body.length > 1200) throw new Error("视频提示词过长，请压缩为 45–85 个英文词的一条连续创作指令。");
    if (/data:image|base64|blob:/i.test(body)) throw new Error("视频提示词不能包含图片数据或临时链接。");
    const latinWords = countLatinWords(body);
    if (latinWords < 45 || latinWords > 85) throw new Error("视频提示词必须以英文为主，并控制为 45–85 个英文词；当地语言只放在引号内的口播中。");
    if (brief.generateAudio && !hasWorkbenchSpokenScript(body)) throw new Error('开启声音时必须提供一条格式为 Spoken script: "..." 的已确认口播。');
    if (!brief.generateAudio && hasWorkbenchSpokenScript(body)) throw new Error("关闭声音时不得包含 Spoken script。");
    const roleBinding = brief.creatorNodeId
        ? "Image 1 holding Image 2 product is the required presenter-product reference."
        : "<IMAGE_1> is the exact product identity and must remain unchanged.";
    const market = ENGLISH_MARKETS[brief.market || ""] || brief.market;
    const platform = ENGLISH_PLATFORMS[brief.platform || ""] || brief.platform;
    const spec = `Create exactly ${brief.seconds} seconds of ${videoAspectRatioForSize(brief.size)} ${platform} commerce footage for ${market}.`;
    const shotBudget = brief.seconds <= 10 ? "Use one setting and up to three visible beats." : "Use up to two related settings and four visible beats.";
    const profileRule =
        capability.promptProfile === "first-last-frame"
            ? "Use references only as temporal frame anchors."
            : capability.promptProfile === "image-anchor"
              ? "Treat the attached image as the exact identity anchor, not a loose style reference."
              : capability.promptProfile === "multimodal"
                ? "Keep each attached image in its declared role and never blend identities."
                : "Keep ordered reference identities distinct and never blend them.";
    const soundRule = brief.generateAudio
        ? brief.withSubtitle
            ? `Use one natural ${brief.language} voice, say the exact Spoken script once, and render that same line as one synchronized subtitle.`
            : `Use one natural ${brief.language} voice and say the exact Spoken script once; no captions or on-screen text.`
        : "No speech, narration, music, captions, or on-screen text.";
    const identityRule = brief.creatorNodeId
        ? "Preserve presenter face, hair, wardrobe and proportions, plus product geometry, scale, colors, parts, logo and label placement."
        : "Preserve product geometry, scale, colors, parts, logo and label placement.";
    const negativeRule = brief.creatorNodeId
        ? "No identity drift, distorted anatomy, extra fingers, product-person hybrid, product warping, invented label or claim, duplicate, or watermark."
        : "No warping, resizing, invented labels or claims, duplicates, floating objects, or watermarks.";
    const compiled = [VIDEO_WORKBENCH_PROMPT_MARKER, spec, roleBinding, shotBudget, profileRule, body, soundRule, identityRule, negativeRule].join(" ").replace(/\s+/g, " ").trim();
    const finalWords = countLatinWords(compiled);
    if (finalWords < 90 || finalWords > 170) throw new Error(`最终视频提示词必须控制为 90–170 个英文词，当前为 ${finalWords} 个；不能重复包装或堆叠规则。`);
    return compiled;
}

function countLatinWords(value: string) {
    return value.match(/[A-Za-z][A-Za-z0-9'’-]*/g)?.length || 0;
}

function normalizeAgentVideoDraftPrompt(value: string) {
    let text = value.trim().replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const label = /(?:\*\*\s*)?(?:英文视频提示词|English video prompt)\s*[:：](?:\s*\*\*)?\s*/i.exec(text);
    if (label) text = text.slice(label.index + label[0].length).trim();
    const nextSection = text.search(/\n\s*(?:#{1,6}\s*)?(?:\*\*\s*)?(?:中文需求摘要|需求摘要|同步字幕|字幕|Chinese summary|Subtitle)(?:\s*\([^\n)]*\))?(?:\s*\*\*)?\s*[:：]/i);
    if (nextSection >= 0) text = text.slice(0, nextSection).trim();
    text = text.replace(/^[-*]\s+/, "").replace(/^`+|`+$/g, "").trim();
    const quotePairs: ReadonlyArray<readonly [string, string]> = [["\"", "\""], ["“", "”"], ["'", "'"]];
    const outerQuotes = quotePairs.find(([open, close]) => text.startsWith(open) && text.endsWith(close));
    if (outerQuotes) text = text.slice(outerQuotes[0].length, -outerQuotes[1].length).trim();
    return text.replace(/\s+/g, " ").trim();
}

function messageDetailKind(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const kind = (value as Record<string, unknown>).kind;
    return typeof kind === "string" ? kind : "";
}

function validateDuration(seconds: number, capability: AvailableAgentVideoModel) {
    const value = Math.floor(Number(seconds));
    if (!Number.isFinite(value)) throw new Error("视频时长无效。");
    if (capability.durationRange) {
        if (value < capability.durationRange[0] || value > capability.durationRange[1]) throw new Error(`所选模型只支持 ${capability.durationRange[0]}–${capability.durationRange[1]} 秒。`);
        return value;
    }
    if (!capability.durations.includes(value)) throw new Error(`所选模型只支持 ${capability.durations.join("、")} 秒。`);
    return value;
}

function sameModelSelection(left: string, right: string) {
    if (modelOptionName(left).toLowerCase() === modelOptionName(right).toLowerCase()) return true;
    const leftCapability = videoModelCapabilityContract(left);
    const rightCapability = videoModelCapabilityContract(right);
    return Boolean(leftCapability && rightCapability && leftCapability.routeFamily === rightCapability.routeFamily);
}

export function agentVideoTypeNeedsCreator(type?: CanvasAgentVideoType) {
    return AGENT_VIDEO_TYPE_OPTIONS.some((item) => item.value === type && item.needsCreator);
}

function agentVideoTypeLabel(type?: CanvasAgentVideoType) {
    return AGENT_VIDEO_TYPE_OPTIONS.find((item) => item.value === type)?.label || "视频创作";
}

function normalizeVideoSize(value?: string): "720x1280" | "1280x720" {
    return value === "1280x720" ? "1280x720" : "720x1280";
}

function cleanBrief(value: Partial<CanvasAgentVideoBrief>): CanvasAgentVideoBrief {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
    ) as CanvasAgentVideoBrief;
}
