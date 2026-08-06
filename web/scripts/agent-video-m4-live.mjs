import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cases = {
    "cn-subtitle-off": {
        withSubtitle: false,
        model: "tokaxis::omni_portrait",
        size: "720x1280",
        userIntent: "在真实中国出租屋开放式厨房中，只用双手展示青绿色陶瓷马克杯的拿取、倒水、日常使用和收尾展示，不虚构功能和促销信息。",
    },
    "cn-subtitle-on": {
        withSubtitle: true,
        model: "tokaxis::omni_portrait",
        size: "720x1280",
        userIntent: "在真实中国出租屋开放式厨房中，只用双手展示青绿色陶瓷马克杯的拿取、倒水、日常使用和收尾展示，不虚构功能和促销信息。",
    },
    "cn-landscape-omni": {
        withSubtitle: false,
        model: "tokaxis::omni",
        size: "1280x720",
        userIntent: "在真实中国出租屋开放式厨房中，用横屏真实手机 UGC 镜头只拍双手展示青绿色陶瓷马克杯，不虚构功能和促销信息。",
    },
};

const [mode, caseId] = process.argv.slice(2);
if (!["compile", "submit", "resume"].includes(mode)) throw new Error("usage: agent-video-m4-live.mjs <compile|submit|resume> <case-id>");
const item = cases[caseId];
if (!item) throw new Error(`unknown case: ${caseId || "(empty)"}`);
const runId = process.env.M4_RUN_ID?.trim();
if (!runId || !/^[a-z0-9_-]+$/iu.test(runId)) throw new Error("M4_RUN_ID is required and must contain only letters, digits, underscore, or hyphen");
const apiKey = process.env.TOKAXIS_API_KEY || "";
if (!apiKey) throw new Error("TOKAXIS_API_KEY is not set");

const runtimeRoot = process.env.M4_RUNTIME_ROOT || "/tmp/codex-m4-runtime";
const sourceRoot = process.env.AGENT_VIDEO_SOURCE_ROOT || path.join(runtimeRoot, "src");
const outputDir = path.join(runtimeRoot, "output", runId, caseId);
const evidenceDir = path.join(runtimeRoot, "evidence");
const baseUrl = process.env.M4_BASE_URL || "http://127.0.0.1:3100/api/tokaxis";
const importSource = (relativePath) => import(pathToFileURL(path.join(sourceRoot, relativePath)).href);
const paths = {
    prompt: path.join(outputDir, "compiled.prompt.txt"),
    transportPrompt: path.join(outputDir, "transport.prompt.txt"),
    compilation: path.join(outputDir, "compilation.json"),
    intent: path.join(outputDir, "submission-intent.json"),
    receipt: path.join(outputDir, "task-receipt.json"),
    video: path.join(outputDir, `${caseId}.mp4`),
    result: path.join(outputDir, "result.json"),
};

fs.mkdirSync(outputDir, { recursive: true });
const productPath = path.join(evidenceDir, "01-base-product.png");
if (!fs.existsSync(productPath)) throw new Error(`missing product reference: ${productPath}`);
const productBytes = fs.readFileSync(productPath);
const productSha256 = sha256(productBytes);
const reference = {
    id: "product-reference",
    name: "01-base-product.png",
    label: "产品参考图",
    type: "image/png",
    dataUrl: `data:image/png;base64,${productBytes.toString("base64")}`,
};

const { AGENT_VIDEO_PRESETS, AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL, AGENT_VIDEO_SUBTITLE_SPEC, AGENT_VIDEO_VISUAL_ONLY_RULE } = await importSource(
    "app/(user)/canvas/utils/agent-video-presets.ts",
);
const { compileAgentVideoPrompt, prepareAgentVideoPromptForGeneration, validateAgentVideoPrompt } = await importSource("app/(user)/canvas/utils/agent-video-sop.ts");
const { resolveReferenceImageVideoConfig } = await importSource("app/(user)/canvas/utils/video-reference-model.ts");
const { defaultConfig, modelOptionName } = await importSource("stores/use-config-store.ts");

const requestedConfig = {
    ...defaultConfig,
    baseUrl,
    apiKey,
    model: item.model,
    videoModel: item.model,
    videoSeconds: "10",
    vquality: "720",
    size: item.size,
    videoGenerateAudio: "true",
    channels: defaultConfig.channels.map((channel) => ({ ...channel, baseUrl, apiKey })),
};
const resolvedConfig = resolveReferenceImageVideoConfig(requestedConfig, 1);

if (mode === "compile") {
    for (const target of [paths.prompt, paths.transportPrompt, paths.compilation]) {
        if (fs.existsSync(target)) throw new Error(`compile artifact already exists: ${target}`);
    }
    const compiled = await compileAgentVideoPrompt({
        config: requestedConfig,
        preset: AGENT_VIDEO_PRESETS.handsfree,
        market: "cn",
        model: item.model,
        size: item.size,
        referenceImages: [reference],
        userIntent: item.userIntent,
        withSubtitle: item.withSubtitle,
    });
    const validation = validateAgentVideoPrompt(compiled.prompt, {
        preset: AGENT_VIDEO_PRESETS.handsfree,
        market: "cn",
        durationSeconds: Number(resolvedConfig.videoSeconds),
        withSubtitle: item.withSubtitle,
    });
    if (validation.errors.length) throw new Error(`compiled prompt validation failed: ${validation.errors.join("；")}`);
    const requiredDisplayRule = item.withSubtitle ? AGENT_VIDEO_SUBTITLE_SPEC : AGENT_VIDEO_VISUAL_ONLY_RULE;
    const forbiddenDisplayRule = item.withSubtitle ? AGENT_VIDEO_VISUAL_ONLY_RULE : AGENT_VIDEO_SUBTITLE_SPEC;
    if (!compiled.prompt.includes(requiredDisplayRule) || compiled.prompt.includes(forbiddenDisplayRule)) throw new Error("compiled prompt contains the wrong display rule");
    if (!compiled.prompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL)) throw new Error("compiled prompt lost the product consistency tail");
    const transportPrompt = prepareAgentVideoPromptForGeneration(compiled.prompt, item.withSubtitle);
    if (transportPrompt.length > 2400 || !transportPrompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL)) throw new Error("transport prompt violates the locked 2400-character contract");
    const voices = Array.from(compiled.prompt.matchAll(/(?:口播|配音)\s*[：:]\s*[“"]([^”"\n]+)[”"]/gu), (match) => match[1]);
    writeExclusive(paths.prompt, compiled.prompt);
    writeExclusive(paths.transportPrompt, transportPrompt);
    const record = {
        runId,
        caseId,
        market: "cn",
        preset: "handsfree",
        withSubtitle: item.withSubtitle,
        requestedModel: modelOptionName(item.model),
        resolvedModel: modelOptionName(resolvedConfig.videoModel || resolvedConfig.model),
        seconds: resolvedConfig.videoSeconds,
        size: resolvedConfig.size,
        resolution: resolvedConfig.vquality,
        generateAudio: resolvedConfig.videoGenerateAudio,
        productReference: { file: path.basename(productPath), sha256: productSha256 },
        promptLength: compiled.prompt.length,
        transportPromptLength: transportPrompt.length,
        promptSha256: sha256(compiled.prompt),
        transportPromptSha256: sha256(transportPrompt),
        requiredDisplayRule,
        requiredDisplayRuleCount: occurrences(compiled.prompt, requiredDisplayRule),
        forbiddenDisplayRuleCount: occurrences(compiled.prompt, forbiddenDisplayRule),
        productTailLast: compiled.prompt.endsWith(AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL),
        voices,
        warnings: compiled.warnings,
        validation,
        compiledAt: new Date().toISOString(),
    };
    writeJsonExclusive(paths.compilation, record);
    console.log(JSON.stringify({ mode, ...record, artifacts: paths }, null, 2));
    process.exit(0);
}

const compilation = readJson(paths.compilation);
const compiledPrompt = fs.readFileSync(paths.prompt, "utf8");
const transportPrompt = fs.readFileSync(paths.transportPrompt, "utf8");
if (compilation.promptSha256 !== sha256(compiledPrompt) || compilation.transportPromptSha256 !== sha256(transportPrompt)) throw new Error("compiled prompt artifacts changed after review");
if (compilation.productReference?.sha256 !== productSha256) throw new Error("product reference changed after prompt compilation");
if (compilation.resolvedModel !== modelOptionName(resolvedConfig.videoModel || resolvedConfig.model) || compilation.size !== resolvedConfig.size) throw new Error("resolved video parameters changed after prompt compilation");

if (mode === "submit") {
    if (process.env.M4_ALLOW_VIDEO_TASK !== "1") throw new Error("real generation is gated; set M4_ALLOW_VIDEO_TASK=1 explicitly");
    if (fs.existsSync(paths.receipt)) throw new Error(`task receipt already exists; resume ${paths.receipt} instead of submitting again`);
    if (fs.existsSync(paths.intent)) throw new Error(`submission intent already exists without a reusable receipt; investigate and never resubmit automatically: ${paths.intent}`);
    const intent = {
        runId,
        caseId,
        stage: "before-create-video-task",
        requestedModel: compilation.requestedModel,
        resolvedModel: compilation.resolvedModel,
        size: compilation.size,
        promptSha256: compilation.transportPromptSha256,
        productReferenceSha256: productSha256,
        createdAt: new Date().toISOString(),
    };
    writeJsonExclusive(paths.intent, intent);
    const { createVideoGenerationTask } = await importSource("services/api/video.ts");
    const task = await createVideoGenerationTask(resolvedConfig, transportPrompt, [reference]);
    const receipt = {
        runId,
        caseId,
        task: { id: task.id, provider: task.provider, model: task.model },
        resolvedRequest: { model: compilation.resolvedModel, seconds: compilation.seconds, size: compilation.size, resolution: compilation.resolution },
        promptSha256: compilation.transportPromptSha256,
        productReferenceSha256: productSha256,
        createdAt: new Date().toISOString(),
    };
    writeJsonExclusive(paths.receipt, receipt);
    console.log(JSON.stringify({ mode, ...receipt, instruction: "resume this exact task; never submit the case again" }, null, 2));
    process.exit(0);
}

const receipt = readJson(paths.receipt);
if (receipt.promptSha256 !== compilation.transportPromptSha256 || receipt.productReferenceSha256 !== productSha256) throw new Error("task receipt does not match reviewed inputs");
if (fs.existsSync(paths.video)) {
    console.log(JSON.stringify({ mode, runId, caseId, task: receipt.task, video: paths.video, sha256: sha256(fs.readFileSync(paths.video)), alreadyDownloaded: true }, null, 2));
    process.exit(0);
}
const { pollVideoGenerationTask } = await importSource("services/api/video.ts");
let result;
let fallbackVideoBytes;
let fallbackMimeType = "";
for (let attempt = 0; attempt < 240; attempt += 1) {
    let state;
    try {
        state = await pollVideoGenerationTask(resolvedConfig, receipt.task);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (receipt.task.provider !== "google-flow" || !message.includes("reading 'includes'")) throw error;
        const response = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(receipt.task.id)}/content`, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!response.ok) throw new Error(`video content recovery failed: ${response.status}`);
        fallbackVideoBytes = Buffer.from(await response.arrayBuffer());
        fallbackMimeType = response.headers.get("content-type") || "video/mp4";
        break;
    }
    if (state.status === "completed") {
        result = state.result;
        break;
    }
    if (state.status === "failed") throw new Error(state.error);
    await new Promise((resolve) => setTimeout(resolve, 2500));
}
if (!result && !fallbackVideoBytes) throw new Error(`task ${receipt.task.id} did not complete; resume it later and do not submit a new task`);
let videoBytes = fallbackVideoBytes;
let mimeType = fallbackMimeType || result?.mimeType || "video/mp4";
if (!videoBytes && result?.blob) videoBytes = Buffer.from(await result.blob.arrayBuffer());
else if (!videoBytes && result?.url) {
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`video download failed: ${response.status}`);
    videoBytes = Buffer.from(await response.arrayBuffer());
    mimeType = response.headers.get("content-type") || mimeType;
}
if (!videoBytes) throw new Error("video result has no blob or URL");
writeExclusive(paths.video, videoBytes);
const record = {
    runId,
    caseId,
    task: receipt.task,
    resolvedRequest: receipt.resolvedRequest,
    video: paths.video,
    bytes: videoBytes.length,
    mimeType,
    sha256: sha256(videoBytes),
    completedAt: new Date().toISOString(),
};
writeJsonExclusive(paths.result, record);
console.log(JSON.stringify({ mode, ...record }, null, 2));

function writeExclusive(file, value) {
    fs.writeFileSync(file, value, { flag: "wx" });
}

function writeJsonExclusive(file, value) {
    writeExclusive(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
    if (!fs.existsSync(file)) throw new Error(`required artifact is missing: ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function occurrences(value, needle) {
    return value.split(needle).length - 1;
}
