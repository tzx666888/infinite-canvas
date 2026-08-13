import assert from "node:assert/strict";
import fs from "node:fs";

import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import type { CanvasAgentSnapshot } from "../src/app/(user)/canvas/utils/canvas-agent-ops.ts";
import { agentVideoCapabilityCatalog, prepareCanvasAgentVideo } from "../src/app/(user)/canvas/utils/canvas-agent-video-guide.ts";
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
assert.match(productPrepared.prompt, /exact product identity reference/i);
assert.match(productPrepared.prompt, /No speech, narration, music, or generated sound/i);
assert.doesNotMatch(productPrepared.prompt, /data:image|base64|blob:/i);

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
assert.match(creatorPrepared.prompt, /<IMAGE_1> holds and demonstrates <IMAGE_2>/);
assert.match(creatorPrepared.prompt, /Senang digunakan setiap hari/);
assert.match(creatorPrepared.prompt, /synchronized subtitle/i);
assert.doesNotMatch(creatorPrepared.prompt, /no captions/i);

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
    /60–100 个英文词/,
);

const assistantSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url), "utf8");
const chatSource = fs.readFileSync(new URL("../src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx", import.meta.url), "utf8");
assert.doesNotMatch(assistantSource, /canvas_request_video_options/);
assert.doesNotMatch(chatSource, /CanvasVideoOptionsCard|video-options/);
assert.match(assistantSource, /toolChoice: "auto"/);
assert.match(assistantSource, /canvas_prepare_video/);

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
            },
            guards: {
                explicitConfirmation: "PASS",
                fixedDuration: "PASS",
                distinctReferences: "PASS",
                unknownModelFailClosed: "PASS",
                imageDataRejected: "PASS",
                promptLengthContract: "PASS",
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
