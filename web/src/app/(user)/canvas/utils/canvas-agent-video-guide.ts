import { nanoid } from "nanoid";

import { videoAspectRatioForSize, videoModelCapabilityContract, videoReferenceMode } from "@/lib/video-model-settings";
import { compileVideoWorkbenchPrompt } from "@/lib/video-workbench-prompt";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasAgentVideoBrief, type CanvasAgentVideoType, type CanvasNodeData } from "../types";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";
import { availableAgentVideoModels, selectedAgentVideoModel, type AvailableAgentVideoModel } from "./agent-video-models";
import { nodeSizeFromRatio } from "./canvas-node-size";
import { resolveReferenceImageVideoConfig } from "./video-reference-model";

export const AGENT_VIDEO_TYPE_OPTIONS: ReadonlyArray<{ value: CanvasAgentVideoType; label: string; needsCreator?: boolean }> = [
    { value: "product-showcase", label: "产品展示" },
    { value: "handsfree-demo", label: "手部演示" },
    { value: "creator", label: "达人出镜", needsCreator: true },
    { value: "unboxing", label: "开箱" },
    { value: "tutorial", label: "教程演示" },
    { value: "pain-solution", label: "痛点解决" },
    { value: "testimonial", label: "买家证言", needsCreator: true },
    { value: "brand-film", label: "品牌广告" },
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
    return "我看到你选中了一张图片。如果这是产品图，我会一步步帮你把视频需求问清楚，再写成适配当前模型的提示词。先告诉我想做哪一种：产品展示、手部演示、达人出镜、开箱、教程、痛点解决、买家证言，还是品牌广告？";
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

export function agentVideoCapabilityCatalog(config: AiConfig, size = "720x1280", referenceImageCount = 1) {
    return availableAgentVideoModels(config, normalizeVideoSize(size), Math.max(1, referenceImageCount)).map((item) => ({
        model: item.value,
        label: item.label,
        durations: item.durationRange ? `${item.durationRange[0]}-${item.durationRange[1]} 秒` : item.durations.map((value) => `${value} 秒`).join(" / "),
        durationOptions: item.durations,
        durationRange: item.durationRange,
        sizes: item.sizes,
        resolution: `${item.resolution}p`,
        referenceImageLimit: item.referenceImageLimit,
        generatedAudio: item.supportsGeneratedAudio,
        promptProfile: item.promptProfile,
    }));
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
    const body = direction.replace(/\s+/g, " ").trim();
    if (body.length < 80) throw new Error("视频提示词必须包含主体动作、场景、镜头、光线和产品展示方式，并控制为 60–100 个英文词。");
    if (body.length > 1600) throw new Error("视频提示词过长，请压缩为 60–100 个英文词的一条连续创作指令。");
    if (/data:image|base64|blob:/i.test(body)) throw new Error("视频提示词不能包含图片数据或临时链接。");
    const latinWords = body.match(/[A-Za-z][A-Za-z0-9'’-]*/g)?.length || 0;
    if (latinWords < 60 || latinWords > 100) throw new Error("视频提示词必须以英文为主，并控制为 60–100 个英文词；当地语言只放在引号内的口播中。");
    const roleBinding = brief.creatorNodeId
        ? "<IMAGE_1> is the approved adult presenter and scene reference. <IMAGE_1> holds and demonstrates <IMAGE_2>, the exact product identity reference."
        : "<IMAGE_1> is the exact product identity reference and must remain unchanged.";
    const shotBudget = brief.seconds <= 10 ? "Use one coherent setting and no more than three visible beats." : "Use no more than two related settings and four visible beats.";
    const profileRule =
        capability.promptProfile === "first-last-frame"
            ? "Treat ordered images only as temporal frame anchors."
            : capability.promptProfile === "image-anchor"
              ? "Treat the attached image as an exact visual identity anchor, not a loose style reference."
              : capability.promptProfile === "multimodal"
                ? "Use each attached image in its declared role and keep every identity distinct."
                : "Use ordered images as distinct identity references, never blend their identities.";
    const soundRule = brief.generateAudio ? `Use natural ${brief.language} audio suitable for ${brief.platform}.` : "No speech, narration, music, or generated sound.";
    const subtitleRule = brief.withSubtitle ? "Render only one synchronized subtitle line at a time in the bottom safe area." : "No captions or on-screen text.";
    const sourcePrompt = [roleBinding, shotBudget, profileRule, body, soundRule, subtitleRule].join(" ");
    return compileVideoWorkbenchPrompt(sourcePrompt, {
        mode: "commerce",
        model: brief.model,
        duration: brief.seconds,
        aspectRatio: videoAspectRatioForSize(brief.size),
        referenceMode: videoReferenceMode(brief.model, brief.creatorNodeId ? 2 : 1),
        referenceCount: brief.creatorNodeId ? 2 : 1,
        sourcePrompt,
        withSubtitles: Boolean(brief.withSubtitle),
        directionWordLimit: 180,
    });
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

function agentVideoTypeNeedsCreator(type?: CanvasAgentVideoType) {
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
