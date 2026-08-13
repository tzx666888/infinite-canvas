import assert from "node:assert/strict";
import { createServer } from "node:http";

import { googleVideoEntryMode, resolveGoogleVideoRouteModelId } from "../src/lib/video-model-settings.ts";
import { createVideoGenerationTask } from "../src/services/api/video.ts";
import { modelMatchesCapability, modelOptionName, defaultConfig } from "../src/stores/use-config-store.ts";
import { availableAgentVideoModels, selectedAgentVideoModel } from "../src/app/(user)/canvas/utils/agent-video-models.ts";
import { resolveReferenceImageVideoConfig } from "../src/app/(user)/canvas/utils/video-reference-model.ts";
import {
    AGENT_VIDEO_CREATOR_FIRST_LINE,
    AGENT_VIDEO_MARKETS,
    AGENT_VIDEO_PRESETS,
    AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL,
    AGENT_VIDEO_REFERENCE_ONLY_RULE,
    AGENT_VIDEO_SUBTITLE_SPEC,
    AGENT_VIDEO_VISUAL_ONLY_RULE,
} from "../src/app/(user)/canvas/utils/agent-video-presets.ts";
import {
    compileAgentVideoPrompt,
    prepareAgentVideoPromptForGeneration,
    splitAgentVideoPrompt,
    validateAgentVideoPrompt,
} from "../src/app/(user)/canvas/utils/agent-video-sop.ts";

const voice = "拿着很稳...真顺手";

function handsfreePrompt(displayRule: string, includeVoice = true) {
    const shots = Array.from({ length: 4 }, (_, index) => {
        const ending = index === 3 ? "完整结果清楚展示，双手轻敲表达满意并自然提示观众试试。" : "持续展示真实物理反馈。";
        return `【转场手法：双手自然遮挡切换】【ASMR音效：陶瓷轻触声】中国出租屋开放式厨房内，双手在操作区域真实拿取并使用产品，保持参考图可见外观、材质、结构和比例，动作符合重力。${ending}${includeVoice || index !== 1 ? `口播：“${voice}”` : ""}`;
    });
    return [AGENT_VIDEO_REFERENCE_ONLY_RULE, ...shots, displayRule, AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL].filter(Boolean).join("\n");
}

function creatorPrompt(displayRule: string) {
    const scenes = ["中国出租屋开放式厨房", "中国宿舍", "中国阳台", "中国工位"];
    const shots = scenes.map((scene, index) => {
        const ending = index === 3 ? "完整结果清楚展示，达人微笑点头表达满意并自然提示观众试试。" : "同一达人持续展示真实物理反馈。";
        return `【转场手法：跟随达人自然移动】【ASMR音效：陶瓷轻触声】同一成年达人在${scene}真实使用同一产品，保持面容、发型与人物一致。${ending}口播：“${voice}”`;
    });
    return [
        AGENT_VIDEO_CREATOR_FIRST_LINE,
        `图二产品参考图约束：${AGENT_VIDEO_REFERENCE_ONLY_RULE}`,
        ...shots,
        displayRule,
        AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL,
    ].join("\n");
}

const offPrompt = handsfreePrompt(AGENT_VIDEO_VISUAL_ONLY_RULE);
const onPrompt = handsfreePrompt(AGENT_VIDEO_SUBTITLE_SPEC);
assert.deepEqual(validateAgentVideoPrompt(offPrompt, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10, withSubtitle: false }).errors, []);
assert.deepEqual(validateAgentVideoPrompt(onPrompt, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10, withSubtitle: true }).errors, []);
assert.match(validateAgentVideoPrompt(handsfreePrompt(""), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 }).errors.join("；"), /纯净画面规则/);
assert.match(validateAgentVideoPrompt(onPrompt, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10, withSubtitle: false }).errors.join("；"), /纯净画面规则|开关规则/);
assert.doesNotMatch(validateAgentVideoPrompt(onPrompt, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10, withSubtitle: true }).errors.join("；"), /画面描述包含字幕/);
assert.match(
    validateAgentVideoPrompt(onPrompt.replace(AGENT_VIDEO_SUBTITLE_SPEC, `${AGENT_VIDEO_SUBTITLE_SPEC}\n镜头中央显示巨大字幕`), {
        preset: AGENT_VIDEO_PRESETS.handsfree,
        market: "cn",
        durationSeconds: 10,
        withSubtitle: true,
    }).errors.join("；"),
    /画面描述包含字幕/,
);

for (const [prompt, withSubtitle, expectedLocks] of [
    [offPrompt, false, 3],
    [creatorPrompt(AGENT_VIDEO_SUBTITLE_SPEC), true, 4],
] as const) {
    const parts = splitAgentVideoPrompt(prompt, withSubtitle);
    assert.equal(parts.map((part) => part.text).join(""), prompt, "split must round-trip byte-for-byte");
    assert.equal(parts.filter((part) => part.kind === "locked").length, expectedLocks);
}
const repeatedTailPrompt = offPrompt.replace(AGENT_VIDEO_VISUAL_ONLY_RULE, `${AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL}\n${AGENT_VIDEO_VISUAL_ONLY_RULE}`);
const repeatedTailParts = splitAgentVideoPrompt(repeatedTailPrompt, false);
assert.equal(repeatedTailParts.filter((part) => part.kind === "locked" && part.text === AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL).length, 1);
assert.equal(repeatedTailParts.at(-1)?.kind, "locked", "the required final product tail must remain the locked occurrence");

const invalidEditedParts = splitAgentVideoPrompt(offPrompt, false).map((part) => (part.kind === "editable" ? { ...part, text: part.text.replace(`口播：“${voice}”`, "") } : part));
const invalidEditedPrompt = invalidEditedParts.map((part) => part.text).join("");
assert.match(validateAgentVideoPrompt(invalidEditedPrompt, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 }).errors.join("；"), /口播/);
assert.ok(invalidEditedPrompt.includes(AGENT_VIDEO_REFERENCE_ONLY_RULE));
assert.ok(invalidEditedPrompt.includes(AGENT_VIDEO_VISUAL_ONLY_RULE));
assert.ok(invalidEditedPrompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL));

assert.equal(prepareAgentVideoPromptForGeneration(offPrompt, false), offPrompt);
const subtitleTransportPrompt = prepareAgentVideoPromptForGeneration(onPrompt, true);
assert.match(subtitleTransportPrompt, /WORKBENCH-DIRECTED VIDEO\./);
assert.ok(subtitleTransportPrompt.includes(AGENT_VIDEO_SUBTITLE_SPEC));
assert.ok(subtitleTransportPrompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL));
const oversizedEditedPrompt = offPrompt.replace(AGENT_VIDEO_VISUAL_ONLY_RULE, `${"详细操作动作与物理反馈。".repeat(260)}\n${AGENT_VIDEO_VISUAL_ONLY_RULE}`);
const fittedEditedPrompt = prepareAgentVideoPromptForGeneration(oversizedEditedPrompt, false);
assert.ok(fittedEditedPrompt.length <= 2400);
assert.ok(fittedEditedPrompt.includes(AGENT_VIDEO_REFERENCE_ONLY_RULE));
assert.ok(fittedEditedPrompt.includes(AGENT_VIDEO_VISUAL_ONLY_RULE));
assert.ok(fittedEditedPrompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL));
const oversizedSubtitlePrompt = onPrompt.replace(AGENT_VIDEO_SUBTITLE_SPEC, `${"详细操作动作与物理反馈。".repeat(260)}\n${AGENT_VIDEO_SUBTITLE_SPEC}`);
assert.match(
    validateAgentVideoPrompt(oversizedSubtitlePrompt, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10, withSubtitle: true }).errors.join("；"),
    /传输后超过 2400/,
);
const fittedSubtitlePrompt = prepareAgentVideoPromptForGeneration(oversizedSubtitlePrompt, true);
assert.ok(fittedSubtitlePrompt.length <= 2400);
assert.ok(fittedSubtitlePrompt.includes(AGENT_VIDEO_REFERENCE_ONLY_RULE));
assert.ok(fittedSubtitlePrompt.includes(AGENT_VIDEO_SUBTITLE_SPEC));
assert.ok(fittedSubtitlePrompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL));

const portraitModels = availableAgentVideoModels(defaultConfig, "720x1280");
const landscapeModels = availableAgentVideoModels(defaultConfig, "1280x720");
const portraitDefault = selectedAgentVideoModel(portraitModels, "omni");
const landscapeDefault = selectedAgentVideoModel(landscapeModels, portraitDefault);
assert.equal(modelOptionName(portraitDefault), "omni_portrait");
assert.equal(modelOptionName(landscapeDefault), "omni");
assert.equal(googleVideoEntryMode(portraitDefault), "omni");
assert.equal(portraitModels.some((item) => googleVideoEntryMode(item.value)?.startsWith("veo")), false);
assert.equal(portraitModels.some((item) => modelOptionName(item.value).toLowerCase().includes("seedance")), false);
assert.ok(portraitModels.some((item) => modelOptionName(item.value).toLowerCase() === "minimax-h3-c4"));
assert.equal(resolveGoogleVideoRouteModelId("omni_portrait", 1, "16:9"), "omni");
assert.equal(resolveGoogleVideoRouteModelId("veo_3_1_i2v_s_fast_portrait_fl", 1, "16:9"), "veo_3_1_i2v_s_fast_fl");
assert.equal(resolveGoogleVideoRouteModelId("veo_3_1_r2v_fast_portrait", 2, "16:9"), "veo_3_1_r2v_fast_landscape");
const configuredSubset = defaultConfig.videoModels.filter((model) => ["omni", "omni_portrait", "minimax-h3-c4"].includes(modelOptionName(model).toLowerCase()));
const configuredSubsetCards = availableAgentVideoModels({ ...defaultConfig, videoModels: configuredSubset }, "720x1280").map((item) => item.value);
assert.ok(configuredSubsetCards.every((model) => configuredSubset.includes(model)), "Agent model card must not escape the configured video-model intersection");
assert.deepEqual(configuredSubsetCards.map(modelOptionName), ["omni_portrait", "MiniMax-H3-c4"]);
const unknownFutureModel = "tokaxis::future-video-model";
assert.equal(modelMatchesCapability(unknownFutureModel, "video"), false);
assert.ok(!availableAgentVideoModels({ ...defaultConfig, videoModels: [...defaultConfig.videoModels, unknownFutureModel] }, "720x1280").some((item) => item.value === unknownFutureModel));
const resolvedLandscapeConfig = resolveReferenceImageVideoConfig(
    { ...defaultConfig, model: portraitDefault, videoModel: portraitDefault, size: "1280x720", videoSeconds: "10", vquality: "720p" },
    1,
);
assert.equal(modelOptionName(resolvedLandscapeConfig.videoModel), "omni");
assert.equal(resolvedLandscapeConfig.size, "1280x720");
const portraitOnlyModels = defaultConfig.videoModels.filter((model) => modelOptionName(model).toLowerCase() === "omni_portrait");
assert.deepEqual(availableAgentVideoModels({ ...defaultConfig, models: portraitOnlyModels, videoModels: portraitOnlyModels }, "1280x720").map((item) => item.value), []);
assert.throws(
    () =>
        resolveReferenceImageVideoConfig(
            { ...defaultConfig, models: portraitOnlyModels, videoModels: portraitOnlyModels, model: portraitOnlyModels[0], videoModel: portraitOnlyModels[0], size: "1280x720" },
            1,
        ),
    /当前令牌未开放路由所需的视频模型：omni/,
);

const compilerConfig = {
    ...defaultConfig,
    baseUrl: "https://example.test/api/tokaxis",
    apiKey: "test-key",
    model: "tokaxis::omni_portrait",
    videoModel: "tokaxis::omni_portrait",
    videoSeconds: "10",
    vquality: "720p",
    size: "720x1280",
    channels: defaultConfig.channels.map((channel) => ({ ...channel, baseUrl: "https://example.test/api/tokaxis", apiKey: "test-key" })),
};
const product = { dataUrl: "data:image/png;base64,AA==", label: "产品参考图" };
let responses: string[] = [];
let systems: string[] = [];
globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    systems.push(body.messages[0].content);
    const prompt = responses.shift();
    assert.ok(prompt !== undefined, "mock response queue exhausted");
    return new Response(JSON.stringify({ choices: [{ message: { content: `[Video Prompt]\n${prompt}` } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

responses = [handsfreePrompt(""), offPrompt];
systems = [];
const retried = await compileAgentVideoPrompt({
    config: compilerConfig,
    preset: AGENT_VIDEO_PRESETS.handsfree,
    market: "cn",
    model: "tokaxis::omni_portrait",
    size: "720x1280",
    referenceImages: [product],
    userIntent: "真实展示产品",
});
assert.equal(retried.prompt, offPrompt);
assert.equal(systems.length, 2, "missing display rule must trigger exactly one retry");
assert.ok(systems.every((system) => system.includes(AGENT_VIDEO_VISUAL_ONLY_RULE) && !system.includes(AGENT_VIDEO_SUBTITLE_SPEC)));

responses = [onPrompt];
systems = [];
await compileAgentVideoPrompt({
    config: compilerConfig,
    preset: AGENT_VIDEO_PRESETS.handsfree,
    market: "cn",
    model: "tokaxis::omni_portrait",
    size: "720x1280",
    referenceImages: [product],
    userIntent: "真实展示产品",
    withSubtitle: true,
});
assert.equal(systems.length, 1);
assert.ok(systems[0].includes(AGENT_VIDEO_SUBTITLE_SPEC));
assert.ok(!systems[0].includes(AGENT_VIDEO_VISUAL_ONLY_RULE));

responses = [handsfreePrompt(""), handsfreePrompt("")];
await assert.rejects(
    compileAgentVideoPrompt({
        config: compilerConfig,
        preset: AGENT_VIDEO_PRESETS.handsfree,
        market: "cn",
        model: "tokaxis::omni_portrait",
        size: "720x1280",
        referenceImages: [product],
        userIntent: "真实展示产品",
    }),
    /缺少纯净画面规则原句/,
);

const capturedRequests: string[] = [];
const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
        capturedRequests.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: `transport-${capturedRequests.length}` }));
    });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const transportConfig = {
        ...compilerConfig,
        baseUrl,
        channels: compilerConfig.channels.map((channel) => ({ ...channel, baseUrl })),
    };
    await createVideoGenerationTask(transportConfig, onPrompt, [product]);
    await createVideoGenerationTask(transportConfig, subtitleTransportPrompt, [product]);
    await createVideoGenerationTask({ ...transportConfig, ...resolvedLandscapeConfig, baseUrl, channels: transportConfig.channels }, offPrompt, [product]);
} finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
assert.match(capturedRequests[0], /No storyboard artifacts: remove panel numbers, grid borders, badges, captions/);
assert.doesNotMatch(capturedRequests[1], /No storyboard artifacts|remove[^\r\n]*captions/iu);
assert.match(capturedRequests[1], /WORKBENCH-DIRECTED VIDEO\./);
assert.ok(capturedRequests[1].includes(AGENT_VIDEO_SUBTITLE_SPEC));
assert.match(capturedRequests[2], /name="model"\r\n\r\nomni\r\n/);
assert.match(capturedRequests[2], /name="size"\r\n\r\n1280x720\r\n/);

console.log(
    JSON.stringify(
        {
            subtitleRules: { off: AGENT_VIDEO_VISUAL_ONLY_RULE, on: AGENT_VIDEO_SUBTITLE_SPEC, retryOnMissing: "PASS" },
            editor: { splitRoundTrip: "PASS", lockedParts: "3 handsfree / 4 creator", invalidEditSubmissionContract: "returns reconstructed prompt with warnings" },
            routing: {
                portraitDefault: modelOptionName(portraitDefault),
                landscapeDefault: modelOptionName(landscapeDefault),
                entries: portraitModels.map((item) => modelOptionName(item.value)),
                disabledEntriesHidden: "Veo and Seedance PASS",
                configuredIntersection: "PASS",
                unintegratedFutureModelHidden: "PASS",
                landscapeResolvedRequest: { model: modelOptionName(resolvedLandscapeConfig.videoModel), size: resolvedLandscapeConfig.size },
                missingOrientationSiblingHiddenBeforeCompile: "PASS",
            },
            subtitleTransport: "multipart contract PASS: subtitle-on bypasses downstream captions removal; 2400-character fit preserves every locked rule",
            markets: Object.fromEntries(Object.entries(AGENT_VIDEO_MARKETS).map(([id, market]) => [id, market.enabled])),
            status: "PASS",
        },
        null,
        2,
    ),
);
