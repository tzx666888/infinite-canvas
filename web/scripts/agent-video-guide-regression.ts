import assert from "node:assert/strict";
import fs from "node:fs";

import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/app/(user)/canvas/utils/canvas-agent-ops.ts";
import { agentVideoCapabilityCatalog, agentVideoConfirmRequest, agentVideoDraftRequest, agentVideoPromptProfileSupportsType, lockPreparedAgentVideoConfig, nextAgentVideoGuideQuestion, prepareCanvasAgentVideo } from "../src/app/(user)/canvas/utils/canvas-agent-video-guide.ts";
import { inferDirectVideoReferencePair } from "../src/app/(user)/canvas/utils/video-reference-model.ts";
import { defaultConfig, modelOptionName } from "../src/stores/use-config-store.ts";

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
const minimax = portraitCatalog.find((item) => modelOptionName(item.model).toLowerCase() === "minimax-h3-c4");
assert.ok(omni, "configured Omni portrait route must be discovered from the central capability contract");
assert.deepEqual(omni.durationOptions, [10]);
assert.equal(omni.referenceImageLimit >= 2, true);
assert.equal(omni.generatedAudio, true);
assert.ok(minimax, "configured MiniMax H3 route must be discovered from the central capability contract");
assert.deepEqual(minimax.durationRange, [5, 15]);
assert.equal(minimax.resolution, "1440p");
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
assert.deepEqual(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id })?.options.slice(0, 3).map((item) => item.label), ["达人出镜", "手部演示", "纯产品展示"]);
assert.match(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id })?.options[0]?.description || "", /带货推荐/);
assert.equal(nextAgentVideoGuideQuestion(defaultConfig, { productNodeId: product.id, videoType: "creator" })?.key, "creatorNodeId");
assert.deepEqual(nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, market: undefined })?.options.map((item) => item.label), ["菲律宾", "马来西亚", "印度尼西亚", "泰国", "越南", "中国"]);
assert.deepEqual(nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, market: "中国", platform: undefined })?.options.map((item) => item.label), ["抖音", "快手"]);
const modelQuestion = nextAgentVideoGuideQuestion(defaultConfig, guidedBrief);
assert.equal(modelQuestion?.key, "model");
assert.equal(modelQuestion?.options.some((item) => item.patch.model === omni.model), true, "model choices must come from the central capability contract");
const omniDurationQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, model: omni.model });
assert.deepEqual(omniDurationQuestion?.options.map((item) => item.label), ["10 秒（模型固定）"]);
const h3DurationQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, model: minimax.model });
assert.deepEqual(h3DurationQuestion?.options.map((item) => item.label), ["5 秒", "10 秒", "15 秒"]);
const noAudioQuestion = nextAgentVideoGuideQuestion(defaultConfig, { ...guidedBrief, model: omni.model, seconds: 10, generateAudio: false });
assert.deepEqual(noAudioQuestion?.options.map((item) => item.patch.withSubtitle), [false], "silent video must not offer an invalid subtitle choice");
const readyBrief = { ...guidedBrief, model: omni.model, seconds: 10, generateAudio: false, withSubtitle: false, sellingPoint: "突出产品外观与质感" };
assert.equal(nextAgentVideoGuideQuestion(defaultConfig, readyBrief), null);
assert.match(agentVideoDraftRequest(readyBrief), /不要重复提问/);
assert.match(agentVideoDraftRequest(readyBrief), /禁止口播、旁白和 Spoken script/);
assert.match(agentVideoConfirmRequest(), /confirmed=true/);

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
assert.equal(productPrepared.ops.some((op) => op.type === "run_generation"), false, "guide must never auto-submit a paid generation");
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
assert.equal(creatorPrepared.ops.some((op) => op.type === "run_generation"), false);
const creatorVideoOp = creatorPrepared.ops.find((op) => op.type === "add_node");
assert.deepEqual(creatorVideoOp?.metadata?.inputOrder, [creator.id, product.id]);
assert.deepEqual(creatorVideoOp?.metadata?.agentVideoReferenceRoles, { productNodeId: product.id, creatorNodeId: creator.id });
assert.match(creatorPrepared.prompt, /Image 1 holding Image 2 product/);
assert.deepEqual(inferDirectVideoReferencePair(creatorPrepared.prompt, 2), { base: 1, reference: 2 }, "creator plus product must enter the existing product-lock bridge path");
assert.match(creatorPrepared.prompt, /Senang digunakan setiap hari/);
assert.match(creatorPrepared.prompt, /synchronized subtitle/i);
assert.doesNotMatch(creatorPrepared.prompt, /no captions/i);
assert.match(agentVideoDraftRequest(creatorPrepared.brief), /Spoken script/);
assert.equal(countLatinWords(creatorPrepared.prompt) <= 170, true);
assert.equal(countLatinWords(creatorPrepared.prompt) >= 90, true);

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
assert.throws(
    () => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: { ...productPrepared.brief, seconds: 15 }, prompt: productDirection }),
    /只支持 10 秒/,
);
assert.throws(
    () => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: { ...creatorPrepared.brief, creatorNodeId: product.id }, prompt: creatorDirection }),
    /不能是同一张/,
);
assert.throws(
    () => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: { ...productPrepared.brief, model: "tokaxis::future-video" }, prompt: productDirection }),
    /当前不可用/,
);
assert.throws(
    () => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: productPrepared.brief, prompt: `${productDirection} data:image/png;base64,AA==` }),
    /不能包含图片数据/,
);
assert.throws(
    () => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: productPrepared.brief, prompt: "Create a clean product video with natural movement." }),
    /45–85 个英文词/,
);
assert.throws(
    () => prepareCanvasAgentVideo(defaultConfig, snapshot, { confirmed: true, brief: creatorPrepared.brief, prompt: productDirection }),
    /Spoken script/,
);

const assistantSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url), "utf8");
const chatSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx", import.meta.url), "utf8");
assert.doesNotMatch(assistantSource, /canvas_request_video_options/);
assert.doesNotMatch(chatSource, /CanvasVideoOptionsCard|video-options/);
assert.match(assistantSource, /toolChoice: "auto"/);
assert.match(assistantSource, /canvas_prepare_video/);
assert.match(assistantSource, /45–85 个英文词/);
assert.match(assistantSource, /Spoken script/);

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
