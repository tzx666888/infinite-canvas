import assert from "node:assert/strict";
import fs from "node:fs";

import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/app/(user)/canvas/utils/canvas-agent-ops.ts";
import {
    agentVideoCapabilityCatalog,
    agentVideoConfirmRequest,
    agentVideoDraftRequest,
    agentVideoPromptProfileSupportsType,
    extractAgentVideoDraftPrompt,
    lockPreparedAgentVideoConfig,
    nextAgentVideoGuideQuestion,
    prepareCanvasAgentVideo,
    shouldRestartAgentVideoGuide,
} from "../src/app/(user)/canvas/utils/canvas-agent-video-guide.ts";
import { inferDirectVideoReferencePair } from "../src/app/(user)/canvas/utils/video-reference-model.ts";
import { prepareVideoGenerationPreflight } from "../src/app/(user)/canvas/utils/video-generation-preflight.ts";
import { defaultConfig, modelOptionName, TOKAXIS_AGENT_TEXT_MODEL_IDS } from "../src/stores/use-config-store.ts";

assert.equal(modelOptionName(defaultConfig.textModel), TOKAXIS_AGENT_TEXT_MODEL_IDS[0], "simple Agent mode must default to GPT-5.6");
assert.deepEqual(TOKAXIS_AGENT_TEXT_MODEL_IDS, ["gpt-5.6-sol", "doubao-seed-2-1-pro-260628"], "simple Agent mode must use GPT-5.6 first and Doubao as its fallback");
assert.equal(defaultConfig.channels[0]?.models.includes("deepseek-v4-pro-ga-260813"), false, "retired DeepSeek must not remain selectable in the platform model list");

const product = imageNode("product", 100, 120);
const creator = imageNode("creator", 100, 620);
const snapshot: CanvasAgentSnapshot = {
    projectId: "guide-regression",
    title: "Agent video guide regression",
    nodes: [product, creator],
    connections: [],
    selectedNodeIds: [product.id],
    viewport: { x: 0, y: 0, k: 1 },
};

const portraitCatalog = agentVideoCapabilityCatalog(defaultConfig, "720x1280", 2);
const omni = portraitCatalog.find((item) => modelOptionName(item.model).toLowerCase() === "omni_portrait");
const minimax = portraitCatalog.find((item) => modelOptionName(item.model).toLowerCase() === "minimaxh3-720p");
assert.ok(omni, "configured Omni portrait route must be discovered from the central capability contract");
assert.deepEqual(omni.durationOptions, [10]);
assert.equal(omni.referenceImageLimit >= 2, true);
assert.equal(omni.generatedAudio, true);
assert.deepEqual(omni.agentPromptLimits, {
    draftTargetWords: [55, 75],
    acceptedDirectionWords: [45, 150],
    compiledWords: [90, 170],
    compactDirectionWords: 72,
});
assert.ok(minimax, "configured MiniMax H3 route must be discovered from the central capability contract");
assert.deepEqual(minimax.durationRange, [5, 15]);
assert.equal(minimax.resolution, "720p");
assert.equal(agentVideoPromptProfileSupportsType("first-last-frame", "creator"), false, "presenter plus product must not be routed to a first/last-frame model");
assert.equal(agentVideoPromptProfileSupportsType("first-last-frame", "testimonial"), false);
assert.equal(agentVideoPromptProfileSupportsType("first-last-frame", "product-showcase"), true, "future models should remain automatically available for compatible product-only work");

const guidedBrief = {
    productNodeId: product.id,
    videoType: "creator" as const,
    creatorNodeId: creator.id,
    market: "印度尼西亚",
    platform: "TikTok Shop",
    language: "Bahasa Indonesia",
    size: "720x1280" as const,
};
assert.equal(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id })?.key, "videoType", "guide must ask exactly one next question");
const globalMarketQuestion = nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id, videoType: "product-showcase" });
assert.equal(globalMarketQuestion?.key, "market");
assert.ok(
    globalMarketQuestion?.options.some((item) => item.patch.market === "全球通用（不指定地域）"),
    "guide must support a region-neutral global route",
);
assert.ok(
    globalMarketQuestion?.options.some((item) => item.patch.market === "澳大利亚"),
    "guide must not be limited to Southeast Asia",
);
assert.deepEqual(
    nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id })
        ?.options.slice(0, 3)
        .map((item) => item.label),
    ["达人出镜（选参考模特）", "手部演示", "纯产品展示"],
);
assert.match(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id })?.options[0]?.description || "", /选择模特图/);
assert.equal(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id, videoType: "creator" })?.key, "creatorNodeId");
assert.equal(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id, videoType: "creator" })?.title, "选择参考模特");
assert.deepEqual(
    nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, market: undefined })?.options.map((item) => item.label),
    ["全球通用（不指定地域）", "美国", "澳大利亚", "英国", "新加坡", "菲律宾", "马来西亚", "印度尼西亚", "泰国", "越南", "中国", "其他国家/地区（完成后补充）"],
);
assert.deepEqual(
    nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, market: "中国", platform: undefined })?.options.map((item) => item.label),
    ["抖音", "快手"],
);
for (const market of ["全球通用（不指定地域）", "美国", "澳大利亚", "英国", "新加坡", "菲律宾", "马来西亚", "印度尼西亚", "泰国", "越南", "中国", "其他国家/地区（完成后补充）"]) {
    const languageQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, market, platform: market === "中国" ? "抖音" : "TikTok Shop", language: undefined });
    assert.equal(languageQuestion?.key, "language", `${market} should advance to language selection`);
    assert.ok(
        languageQuestion?.options.some((item) => item.patch.language === "English"),
        `${market} should explicitly offer English`,
    );
}
const modelQuestion = nextAgentVideoGuideQuestion(defaultConfig, guidedBrief);
assert.equal(modelQuestion?.key, "model");
assert.equal(
    modelQuestion?.options.some((item) => item.patch.model === omni.model),
    true,
    "model choices must come from the central capability contract",
);
const omniDurationQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, model: omni.model });
assert.deepEqual(
    omniDurationQuestion?.options.map((item) => item.label),
    ["10 秒（模型固定）"],
);
const h3DurationQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, model: minimax.model });
assert.deepEqual(
    h3DurationQuestion?.options.map((item) => item.label),
    ["5 秒", "10 秒", "15 秒"],
);
const h3Preflight = prepareVideoGenerationPreflight({
    prompt: "A clean product demonstration with natural camera motion.",
    config: { ...defaultConfig, model: minimax.model, videoModel: minimax.model, baseUrl: "/api/tokaxis", videoSeconds: "15", size: "720x1280", vquality: "720" },
    references: { images: [{ id: "product", name: "product.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" }], videos: [], audios: [] },
});
assert.deepEqual(h3Preflight.errors, [], "MiniMax H3 720p must pass connected image-to-video preflight");
assert.equal(h3Preflight.config.videoModel, minimax.model);
assert.equal(h3Preflight.config.vquality, "720");
const removedH3Preflight = prepareVideoGenerationPreflight({
    prompt: "A clean product demonstration.",
    config: { ...defaultConfig, model: "tokaxis::MiniMax-H3-c4", videoModel: "tokaxis::MiniMax-H3-c4", baseUrl: "/api/tokaxis" },
    references: { images: [], videos: [], audios: [] },
});
assert.equal(removedH3Preflight.errors.length > 0, true, "removed MiniMax H3 C4 must fail closed");
const noAudioQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, model: omni.model, seconds: 10, generateAudio: false });
assert.deepEqual(
    noAudioQuestion?.options.map((item) => item.patch.withSubtitle),
    [false],
    "silent video must not offer an invalid subtitle choice",
);
const readyBrief = { ...guidedBrief, model: omni.model, seconds: 10, generateAudio: false, withSubtitle: false, sellingPoint: "突出产品外观与质感" };
assert.equal(nextAgentVideoGuideQuestion(defaultConfig, readyBrief), null);
assert.match(agentVideoDraftRequest(readyBrief), /不要重复提问/);
assert.match(agentVideoDraftRequest(readyBrief), /禁止口播、旁白和 Spoken script/);
assert.match(agentVideoConfirmRequest(), /confirmed=true/);
const extractedDraftPrompt = extractAgentVideoDraftPrompt([
    { role: "assistant", text: "旧回复" },
    { role: "user", text: "选项已完成，请生成适配提示词", detail: { kind: "video-guide-draft-request" } },
    {
        role: "assistant",
        text: "需求摘要：越南 TikTok Shop 竖屏带货。 英文视频提示词：\"Create a 15-second vertical video (720x1280) for TikTok Shop Vietnam using MiniMaxH3-720p. Show the product from the reference image in a natural everyday Vietnamese home scene. Keep its identity, colors, labels, and proportions exactly as in the reference. Depict a person using it casually in real time, with soft natural lighting and a clean, uncluttered background. No extra text, logos, or graphic overlays. Spoken script (Vietnamese): 'Cùng xem sản phẩm này trong cuộc sống hằng ngày nhé.' Subtitle: same Vietnamese sentence, synced.\"",
    },
]);
assert.match(extractedDraftPrompt, /^Create a 15-second vertical video/);
assert.match(extractedDraftPrompt, /Spoken script: "Cùng xem sản phẩm này trong cuộc sống hằng ngày nhé\."$/);
assert.doesNotMatch(extractedDraftPrompt, /需求摘要|同步字幕|英文视频提示词/);
assert.doesNotMatch(extractedDraftPrompt, /Subtitle:/);
const qualifiedSpokenDraftPrompt = extractAgentVideoDraftPrompt([
    { role: "user", text: "选项已完成，请生成适配提示词", detail: { kind: "video-guide-draft-request" } },
    {
        role: "assistant",
        text: 'English video prompt: Create a clean vertical TikTok Shop product video in one bright Indonesian home, keeping the exact product shape, colors, label, scale, and visible details stable through a gentle push-in, one natural demonstration, and a final hero close-up with warm commercial lighting. Spoken script in Bahasa Indonesia: "Lihat produknya lebih dekat dan temukan detail yang cocok untuk keseharianmu."',
    },
]);
assert.match(qualifiedSpokenDraftPrompt, /Spoken script: "Lihat produknya lebih dekat/);
assert.doesNotMatch(qualifiedSpokenDraftPrompt, /Spoken script in Bahasa Indonesia/);

const onlinePanelSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url), "utf8");
const localPanelSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-local-agent-panel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(onlinePanelSource, /sendMessage\(agentVideoConfirmRequest/);
assert.doesNotMatch(localPanelSource, /sendPrompt\(agentVideoConfirmRequest/);
assert.match(onlinePanelSource, /onPrepareAgentVideo\(\{ brief: activeSession\.videoBrief, prompt, confirmed: true \}\)/);
assert.match(localPanelSource, /onPrepareAgentVideoRef\.current\(\{ brief: videoBriefRef\.current, prompt, confirmed: true \}\)/);
assert.match(onlinePanelSource, /extractAgentVideoDraftPrompt\(activeSession\.messages\)/);
assert.match(localPanelSource, /extractAgentVideoDraftPrompt\(useCanvasAgentStore\.getState\(\)\.messages\)/);

const productDirection =
    "Open on the exact product standing upright on a clean Indonesian kitchen counter under warm window light, then let an adult hand lift it at realistic scale, demonstrate one smooth practical use, and return it beside the package for a crisp hero close-up. Keep the same silhouette, colors, materials, labels, part count, and proportions throughout, with restrained camera motion and believable contact shadows.";
const productPrepared = prepareCanvasAgentVideo(defaultConfig, snapshot, {
    confirmed: true,
    brief: {
        productNodeId: product.id,
        videoType: "handsfree-demo",
        market: "印度尼西亚",
        platform: "TikTok Shop",
        language: "Bahasa Indonesia",
        model: omni.model,
        seconds: 10,
        size: "720x1280",
        generateAudio: false,
        withSubtitle: false,
        sellingPoint: "单手操作简单",
    },
    prompt: productDirection,
});
assert.equal(
    productPrepared.ops.some((op) => op.type === "run_generation"),
    false,
    "guide must never auto-submit a paid generation",
);
const productVideoOp = productPrepared.ops.find((op) => op.type === "add_node");
assert.equal(productVideoOp?.nodeType, CanvasNodeType.Video);
assert.deepEqual(productVideoOp?.metadata?.inputOrder, [product.id]);
assert.equal(productVideoOp?.metadata?.status, "idle");
assert.match(productPrepared.prompt, /^WORKBENCH-DIRECTED VIDEO\./);
assert.match(productPrepared.prompt, /exact product identity/i);
assert.match(productPrepared.prompt, /No speech, narration, music, captions, or on-screen text/i);
assert.doesNotMatch(productPrepared.prompt, /Preserve the adult face/i);
assert.equal(countLatinWords(productPrepared.prompt) <= 170, true, "final provider prompt must stay compact after adding identity rules");
assert.equal(countLatinWords(productPrepared.prompt) >= 90, true);
assert.equal(productPrepared.prompt.match(/WORKBENCH-DIRECTED VIDEO\./g)?.length, 1, "guided prompt must be compiled exactly once");
assert.match(productPrepared.prompt, /commerce footage for Indonesia/);
assert.doesNotMatch(productPrepared.prompt, /印度尼西亚/);
assert.doesNotMatch(productPrepared.prompt, /data:image|base64|blob:/i);
const alreadyMarkedPrepared = prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: productPrepared.brief, prompt: `WORKBENCH-DIRECTED VIDEO. ${productDirection}` });
assert.equal(alreadyMarkedPrepared.prompt.match(/WORKBENCH-DIRECTED VIDEO\./g)?.length, 1, "an accidental existing marker must not trigger double compilation");

const landscapePrepared = prepareCanvasAgentVideo(defaultConfig, snapshot, {
    confirmed: true,
    brief: { ...productPrepared.brief, model: omni.model, size: "1280x720" },
    prompt: productDirection,
});
assert.equal(modelOptionName(landscapePrepared.brief.model || ""), "omni", "orientation sibling must be selected through the shared route family");

const creatorDirection =
    'The approved adult presenter stands in one bright Malaysian home studio and immediately holds the exact product toward camera, then demonstrates the main control with one natural hand movement while keeping the label readable, and finishes with the unchanged product beside the face in a confident close-up. Use warm commercial lighting, subtle handheld energy, realistic grip and scale, and natural Bahasa Melayu speech. Spoken script: "Senang digunakan setiap hari."';
const creatorPrepared = prepareCanvasAgentVideo(defaultConfig, snapshot, {
    confirmed: true,
    brief: {
        productNodeId: product.id,
        creatorNodeId: creator.id,
        videoType: "creator",
        market: "马来西亚",
        platform: "TikTok Shop",
        language: "Bahasa Melayu",
        model: minimax.model,
        seconds: 15,
        size: "720x1280",
        generateAudio: true,
        withSubtitle: true,
        sellingPoint: "每天使用都简单",
    },
    prompt: creatorDirection,
});
assert.equal(
    creatorPrepared.ops.some((op) => op.type === "run_generation"),
    false,
);
const creatorVideoOp = creatorPrepared.ops.find((op) => op.type === "add_node");
assert.deepEqual(creatorVideoOp?.metadata?.inputOrder, [creator.id, product.id]);
assert.deepEqual(creatorVideoOp?.metadata?.agentVideoReferenceRoles, { productNodeId: product.id, creatorNodeId: creator.id });
assert.match(creatorPrepared.prompt, /Image 1 holding Image 2 product/);
assert.deepEqual(inferDirectVideoReferencePair(creatorPrepared.prompt, 2), { base: 1, reference: 2 }, "creator plus product must enter the existing product-lock bridge path");
const productionDraftPrepared = prepareCanvasAgentVideo(defaultConfig, snapshot, {
    confirmed: true,
    brief: { ...creatorPrepared.brief, market: "越南", platform: "TikTok Shop", language: "Tiếng Việt", model: minimax.model, seconds: 15, size: "720x1280", generateAudio: true, withSubtitle: true },
    prompt: extractedDraftPrompt,
});
assert.equal(countLatinWords(productionDraftPrepared.prompt) <= 170, true, "a valid 85-word draft must be compacted to fit the final provider prompt budget");
assert.match(productionDraftPrepared.prompt, /Spoken script: "Cùng xem sản phẩm này trong cuộc sống hằng ngày nhé\."/);
assert.doesNotMatch(productionDraftPrepared.prompt, /Subtitle:/);
assert.match(creatorPrepared.prompt, /Senang digunakan setiap hari/);
assert.match(creatorPrepared.prompt, /synchronized subtitle/i);
assert.doesNotMatch(creatorPrepared.prompt, /no captions/i);
assert.match(agentVideoDraftRequest(creatorPrepared.brief), /Spoken script/);
assert.equal(countLatinWords(creatorPrepared.prompt) <= 170, true);
assert.equal(countLatinWords(creatorPrepared.prompt) >= 90, true);
assert.equal(shouldRestartAgentVideoGuide({ productNodeId: product.id }, "collecting", "生成一个印尼带货视频"), false, "incomplete guide must keep its current question");
assert.equal(shouldRestartAgentVideoGuide(creatorPrepared.brief, "prepared", "生成一个印尼带货视频"), true, "a new video request must restart a completed guide instead of reusing stale selections");
assert.equal(shouldRestartAgentVideoGuide(creatorPrepared.brief, "prepared", "把视频提示词改短"), false, "editing a prompt must not restart the video guide");

const preparedSnapshot = applyCanvasAgentOps(snapshot, creatorPrepared.ops);
const preparedNode = preparedSnapshot.nodes.find((node) => node.id === creatorPrepared.videoNodeId);
assert.ok(preparedNode, "prepared video node must exist");
const lockedConfig = lockPreparedAgentVideoConfig({ ...defaultConfig, model: omni.model, videoModel: omni.model, videoSeconds: "10", size: "1280x720", vquality: "720" }, preparedNode);
assert.equal(lockedConfig.model, creatorPrepared.brief.model, "generation must use the model that compiled the Agent prompt");
assert.equal(lockedConfig.videoModel, creatorPrepared.brief.model);
assert.equal(lockedConfig.videoSeconds, String(creatorPrepared.brief.seconds));
assert.equal(lockedConfig.size, creatorPrepared.brief.size);
assert.equal(lockedConfig.vquality, creatorVideoOp?.metadata?.vquality);
assert.notEqual(lockedConfig.vquality, "720");
assert.equal(lockedConfig.videoGenerateAudio, String(creatorPrepared.brief.generateAudio));

assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: false, brief: productPrepared.brief, prompt: productDirection }), /尚未确认/);
assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: { ...productPrepared.brief, seconds: 15 }, prompt: productDirection }), /只支持 10 秒/);
assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: { ...creatorPrepared.brief, creatorNodeId: product.id }, prompt: creatorDirection }), /不能是同一张/);
assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: { ...productPrepared.brief, model: "tokaxis::future-video" }, prompt: productDirection }), /当前不可用/);
assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: productPrepared.brief, prompt: `${productDirection} data:image/png;base64,AA==` }), /不能包含图片数据/);
assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: productPrepared.brief, prompt: "Create a clean product video with natural movement." }), /45–150 个英文词/);
assert.throws(() => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: creatorPrepared.brief, prompt: productDirection }), /Spoken script/);

const assistantSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url), "utf8");
const localAssistantSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-local-agent-panel.tsx", import.meta.url), "utf8");
const chatSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx", import.meta.url), "utf8");
const guideCardSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-agent-video-guide-card.tsx", import.meta.url), "utf8");
const imageApiSource = fs.readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
const videoApiSource = fs.readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const videoModelSettingsSource = fs.readFileSync(new URL("../src/lib/video-model-settings.ts", import.meta.url), "utf8");
const canvasPageSource = fs.readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
assert.match(canvasPageSource, /visible materials, colors, markings, part count, and part placement/, "the product bridge must copy only visible product facts from the attached product image");
assert.doesNotMatch(canvasPageSource, /red\/white pattern/, "the product bridge must not hard-code an unrelated product color pattern");
assert.match(videoApiSource, /single attached image is the exact product\/object identity anchor/, "single connected product images must be sent as identity anchors");
assert.match(imageApiSource, /模型没有返回工具调用/, "an empty tool response must be eligible for the configured Agent model fallback");
assert.match(imageApiSource, /TOKAXIS_AGENT_TEXT_MODEL_IDS/, "Agent requests must know the GPT-5.6/Doubao fallback pair");
assert.match(imageApiSource, /isLegacyDeepSeekAgent/, "stale tabs must skip the retired DeepSeek Agent route");
assert.match(imageApiSource, /model_not_found\|no available\|无可用渠道/, "missing model routes must switch to the fallback without retrying the same route");
assert.match(assistantSource, /ASSISTANT_STREAM_RENDER_INTERVAL_MS = 80/, "streaming Agent replies must be rendered at a bounded cadence");
assert.equal(assistantSource.match(/scheduleAssistantStream\(sessionId, assistantId, text\)/g)?.length, 2, "both online Agent stream loops must use the bounded renderer");
assert.equal(assistantSource.match(/flushAssistantStream\(sessionId, assistantId,/g)?.length, 2, "both online Agent stream loops must flush their final reply immediately");
assert.doesNotMatch(assistantSource, /canvas_request_video_options/);
assert.doesNotMatch(chatSource, /CanvasVideoOptionsCard|video-options/);
assert.match(assistantSource, /draftOnly \? "none" : "auto"/, "guided prompt drafting must not carry unrelated canvas tools");
assert.match(assistantSource, /requestToolResponse\([^\n]+draftOnly \? \[\] : ONLINE_AGENT_TOOLS, draftOnly \? "none" : "auto"/, "guided prompt drafting must explicitly disable tool choice when no tools are supplied");
assert.match(imageApiSource, /type ToolChoice = "auto" \| "none" \| "required"/, "the response client must support the standard no-tools choice");
assert.match(imageApiSource, /body\.tools\.length === 0 && body\.tool_choice === "none"/, "guided prompt drafting must use a finite JSON response instead of a hanging SSE stream");
assert.match(assistantSource, /buildVideoGuideDraftMessages\(currentBrief\)/, "guided prompt drafting must use the minimal dedicated context");
assert.doesNotMatch(assistantSource, /draftOnly \? buildToolAgentMessages/, "guided prompt drafting must not serialize the full canvas or reference images");
assert.match(assistantSource, /canvas_prepare_video/);
assert.match(assistantSource, /agentVideoPromptLimits\(brief\?\.model\)/, "guided drafting must read the selected model's prompt limits");
assert.match(videoModelSettingsSource, /agentPromptLimits: DEFAULT_AGENT_VIDEO_PROMPT_LIMITS/, "video models must expose Agent prompt limits through the central capability contract");
assert.match(assistantSource, /Spoken script/);
assert.match(assistantSource, /shouldRestartAgentVideoGuide/);
assert.match(localAssistantSource, /shouldRestartAgentVideoGuide/);
assert.match(guideCardSource, /用作参考模特/);

console.log(
    JSON.stringify(
        {
            capabilityRouting: portraitCatalog.map(({ model, durationOptions, durationRange, referenceImageLimit, generatedAudio, promptProfile }) => ({
                model: modelOptionName(model),
                durationOptions,
                durationRange,
                referenceImageLimit,
                generatedAudio,
                promptProfile,
            })),
            guidedPreparation: {
                productOnly: "PASS",
                creatorAndProductOrder: [creator.id, product.id],
                bridgeRolePhrase: "PASS",
                subtitleSwitch: "PASS",
                noAutomaticGeneration: "PASS",
                orientationRouteFamily: "PASS",
                oneClickQuestionSequence: "PASS",
                dynamicModelAndDurationChoices: "PASS",
                firstLastFrameRoleGuard: "PASS",
                noTypingRequired: "PASS",
                newVideoRequestRestartsGuide: "PASS",
                presenterReferencePicker: "PASS",
            },
            guards: {
                explicitConfirmation: "PASS",
                fixedDuration: "PASS",
                distinctReferences: "PASS",
                unknownModelFailClosed: "PASS",
                imageDataRejected: "PASS",
                promptLengthContract: "PASS",
                finalPromptSingleCompile: "PASS",
                preparedModelLock: "PASS",
                explicitSpeechContract: "PASS",
                englishMarketAndPlatform: "PASS",
                legacyCardRemoved: "PASS",
            },
            status: "PASS",
        },
        null,
        2,
    ),
);

function imageNode(id: string, x: number, y: number): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x, y },
        width: 320,
        height: 420,
        metadata: { content: `https://assets.example.test/${id}.png`, status: "success" },
    };
}

function countLatinWords(value: string) {
    return value.match(/[A-Za-z][A-Za-z0-9'’-]*/g)?.length || 0;
}
