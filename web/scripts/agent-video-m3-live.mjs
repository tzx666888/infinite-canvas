import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cases = {
    "creator-ph-omni": {
        presetId: "creator",
        market: "ph",
        generate: false,
        userIntent: "让同一位成年生活方式达人在真实菲律宾居家场景中展示青绿色陶瓷马克杯的日常使用，不虚构功能。",
    },
    "creator-my-omni": {
        presetId: "creator",
        market: "my",
        generate: false,
        userIntent: "让同一位成年生活方式达人在真实马来西亚居家场景中展示青绿色陶瓷马克杯的日常使用，不虚构功能。",
    },
    "creator-th-omni": {
        presetId: "creator",
        market: "th",
        generate: false,
        userIntent: "让同一位成年生活方式达人在真实泰国居家场景中展示青绿色陶瓷马克杯的日常使用，不虚构功能。",
    },
    "creator-id-omni": {
        presetId: "creator",
        market: "id",
        generate: true,
        userIntent: "让同一位成年生活方式达人在真实印度尼西亚居家场景中展示青绿色陶瓷马克杯的日常使用，不虚构功能。",
    },
    "creator-cn-omni": {
        presetId: "creator",
        market: "cn",
        generate: true,
        userIntent: "让同一位成年生活方式达人在真实中国居家场景中展示青绿色陶瓷马克杯的日常使用，不虚构功能和促销信息。",
    },
    "handsfree-id-omni": {
        presetId: "handsfree",
        market: "id",
        generate: true,
        userIntent: "在真实印度尼西亚居家场景中只用双手展示青绿色陶瓷马克杯的拿取、倒水、饮用和清洁，不虚构功能。",
    },
    "handsfree-cn-omni": {
        presetId: "handsfree",
        market: "cn",
        generate: true,
        userIntent: "在真实中国居家场景中只用双手展示青绿色陶瓷马克杯的拿取、倒水、饮用和清洁，不虚构功能和促销信息。",
    },
};

const [caseId] = process.argv.slice(2);
const item = cases[caseId];
if (!item) throw new Error(`unknown case: ${caseId || "(empty)"}`);
const apiKey = process.env.TOKAXIS_API_KEY || "";
if (!apiKey) throw new Error("TOKAXIS_API_KEY is not set");

const runtimeRoot = process.env.M3_RUNTIME_ROOT || "/app/web/.codex-m3-runtime";
const sourceRoot = path.join(runtimeRoot, "src");
const outputDir = path.join(runtimeRoot, "output");
fs.mkdirSync(outputDir, { recursive: true });
const importSource = (relativePath) => import(pathToFileURL(path.join(sourceRoot, relativePath)).href);
const { AGENT_VIDEO_PRESETS, AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL } = await importSource("app/(user)/canvas/utils/agent-video-presets.ts");
const { compileAgentVideoPrompt, validateAgentVideoPrompt } = await importSource("app/(user)/canvas/utils/agent-video-sop.ts");
const { resolveReferenceImageVideoConfig } = await importSource("app/(user)/canvas/utils/video-reference-model.ts");
const { defaultConfig } = await importSource("stores/use-config-store.ts");

const toDataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const imageByRole = {
    creator: {
        id: "creator-reference",
        name: "00-creator-reference.png",
        label: "图一达人",
        type: "image/png",
        dataUrl: toDataUrl(path.join(runtimeRoot, "evidence/00-creator-reference.png")),
    },
    product: {
        id: "product-reference",
        name: "01-base-product.png",
        label: item.presetId === "creator" ? "图二产品" : "产品参考图",
        type: "image/png",
        dataUrl: toDataUrl(path.join(runtimeRoot, "evidence/01-base-product.png")),
    },
};
const references = (item.presetId === "creator" ? ["creator", "product"] : ["product"]).map((role) => imageByRole[role]);
const model = "tokaxis::omni_portrait";
const baseUrl = "http://127.0.0.1:3100/api/tokaxis";
const requestedConfig = {
    ...defaultConfig,
    baseUrl,
    apiKey,
    model,
    videoModel: model,
    videoSeconds: "10",
    vquality: "720",
    size: "720x1280",
    videoGenerateAudio: "true",
    channels: defaultConfig.channels.map((channel) => ({ ...channel, baseUrl, apiKey })),
};
const config = resolveReferenceImageVideoConfig(requestedConfig, references.length);
const compiled = await compileAgentVideoPrompt({
    config: requestedConfig,
    preset: AGENT_VIDEO_PRESETS[item.presetId],
    market: item.market,
    model,
    size: "720x1280",
    referenceImages: references,
    userIntent: item.userIntent,
});
const validation = validateAgentVideoPrompt(compiled.prompt, {
    preset: AGENT_VIDEO_PRESETS[item.presetId],
    market: item.market,
    durationSeconds: Number(config.videoSeconds),
});
if (validation.errors.length) throw new Error(`compiled prompt validation failed: ${validation.errors.join("；")}`);

const outputPrefix = path.join(outputDir, `m3-${caseId}`);
const promptPath = `${outputPrefix}.prompt.txt`;
const videoPath = `${outputPrefix}.mp4`;
const metadataPath = `${outputPrefix}.json`;
const receiptPath = `${outputPrefix}.receipt.json`;
fs.writeFileSync(promptPath, compiled.prompt);

const generationAllowed = item.generate && process.env.M3_ALLOW_VIDEO_TASK === "1";
if (item.generate && !generationAllowed) throw new Error("real generation is gated; set M3_ALLOW_VIDEO_TASK=1 explicitly");
if (!item.generate && process.env.M3_ALLOW_VIDEO_TASK === "1") throw new Error("this case is compile-only and cannot create a paid task");

let videoBytes = Buffer.alloc(0);
let mimeType = "";
let taskReceipt = null;
if (generationAllowed) {
    if (fs.existsSync(receiptPath)) throw new Error(`task receipt already exists; resume task ${receiptPath} instead of submitting again`);
    const { createVideoGenerationTask, pollVideoGenerationTask } = await importSource("services/api/video.ts");
    const task = await createVideoGenerationTask(config, compiled.prompt, references);
    taskReceipt = { id: task.id, provider: task.provider, model: task.model || model, createdAt: new Date().toISOString() };
    fs.writeFileSync(receiptPath, JSON.stringify(taskReceipt, null, 2), { flag: "wx" });

    let result = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
        try {
            const state = await pollVideoGenerationTask(config, task);
            if (state.status === "completed") {
                result = state.result;
                break;
            }
            if (state.status === "failed") throw new Error(state.error);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (task.provider !== "google-flow" || !message.includes("reading 'includes'")) throw error;
            const response = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(task.id)}/content`, { headers: { Authorization: `Bearer ${apiKey}` } });
            if (!response.ok) throw new Error(`video content download failed: ${response.status} ${await response.text()}`);
            videoBytes = Buffer.from(await response.arrayBuffer());
            mimeType = response.headers.get("content-type") || "video/mp4";
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!result && !videoBytes.length) throw new Error(`task ${task.id} did not reach a completed state; resume it, do not submit a new task`);
    if (result) {
        mimeType = result.mimeType || "video/mp4";
        if (result.blob) videoBytes = Buffer.from(await result.blob.arrayBuffer());
        else if (result.url) {
            const response = await fetch(result.url);
            if (!response.ok) throw new Error(`video download failed: ${response.status}`);
            videoBytes = Buffer.from(await response.arrayBuffer());
        } else throw new Error("video result has no blob or url");
    }
    fs.writeFileSync(videoPath, videoBytes);
}

const metadata = {
    caseId,
    presetId: item.presetId,
    market: item.market,
    requestedModel: model,
    resolvedModel: config.videoModel || config.model,
    seconds: config.videoSeconds,
    size: config.size,
    vquality: config.vquality,
    generateAudio: config.videoGenerateAudio,
    referenceOrder: references.map((reference) => reference.label),
    promptLength: compiled.prompt.length,
    promptWarnings: compiled.warnings,
    validation,
    promptHasConsistencyTail: compiled.prompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL),
    generationPerformed: generationAllowed,
    task: taskReceipt,
    videoBytes: videoBytes.length,
    mimeType,
    promptPath,
    videoPath: generationAllowed ? videoPath : null,
};
fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata, null, 2));
