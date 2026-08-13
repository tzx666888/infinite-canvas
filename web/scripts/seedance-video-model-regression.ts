import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    buildTokaxisSeedanceVideoPayload,
    isSeedanceFixed720pModel,
    isSeedanceVideoModel,
    isTokaxisSeedanceVideoModel,
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceDurationOptionsForModel,
    seedanceRatioOptionsForModel,
    seedanceResolutionOptionsForModel,
    seedanceSupportsGeneratedAudio,
    seedanceSupportsVideoAudioReferences,
    TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS,
} from "../src/lib/seedance-video.ts";
import { parseSeedanceVideoTaskState } from "../src/services/api/video/seedance-adapter.ts";

const fixed = "Seedance 2.0-fast-720p";
const standard = "qy-seedance-2.0";
const fast = "qy-seedance-2.0-fast";

assert.deepEqual(TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS, [fixed, standard, fast]);
for (const model of TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS) {
    assert.equal(isSeedanceVideoModel(`tokaxis::${model}`), true, `${model} must be recognized as Seedance`);
    assert.equal(isTokaxisSeedanceVideoModel(`tokaxis::${model}`), true, `${model} must use the TokAxis Seedance protocol`);
}

assert.equal(isSeedanceFixed720pModel(fixed), true);
assert.equal(normalizeSeedanceResolution("1080p", fixed), "720p");
assert.deepEqual(
    seedanceResolutionOptionsForModel(fixed).map((item) => item.value),
    ["720p"],
);
assert.equal(seedanceSupportsGeneratedAudio(fixed), false);
assert.equal(seedanceSupportsVideoAudioReferences(fixed), false);
assert.deepEqual(seedanceDurationOptionsForModel(fixed), [5, 10, 15]);
assert.equal(
    seedanceRatioOptionsForModel(fixed).some((item) => item.value === "21:9"),
    false,
);
assert.equal(normalizeSeedanceRatio("21:9", fixed), "adaptive");

assert.equal(normalizeSeedanceResolution("1080p", fast), "720p");
assert.deepEqual(
    seedanceResolutionOptionsForModel(fast).map((item) => item.value),
    ["480p", "720p"],
);
assert.equal(normalizeSeedanceResolution("1080p", standard), "1080p");
assert.equal(seedanceSupportsGeneratedAudio(standard), true);
assert.equal(seedanceSupportsVideoAudioReferences(standard), true);
assert.equal(normalizeSeedanceDuration("4", fixed), 5);
assert.equal(normalizeSeedanceDuration("8", fixed), 10);
assert.equal(normalizeSeedanceDuration("12", fixed), 10);
assert.equal(normalizeSeedanceDuration("16", fixed), 15);
assert.equal(normalizeSeedanceDuration("8", standard), 10);

assert.deepEqual(
    buildTokaxisSeedanceVideoPayload({
        model: fixed,
        prompt: "move",
        images: ["https://example.test/a.png"],
        videos: ["https://example.test/a.mp4"],
        audios: ["https://example.test/a.mp3"],
        duration: "8",
        resolution: "1080p",
        ratio: "9:16",
        generateAudio: false,
        watermark: false,
    }),
    {
        model: fixed,
        prompt: "move",
        images: ["https://example.test/a.png"],
        duration: 10,
        resolution: "720p",
        aspect_ratio: "9:16",
    },
    "the fixed model payload must omit unsupported references and audio fields entirely",
);
assert.deepEqual(
    buildTokaxisSeedanceVideoPayload({
        model: standard,
        prompt: "move",
        images: ["image"],
        videos: ["video"],
        audios: ["audio"],
        duration: "8",
        resolution: "1080p",
        ratio: "adaptive",
        generateAudio: false,
        watermark: true,
    }),
    {
        model: standard,
        prompt: "move",
        images: ["image"],
        videos: ["video"],
        audios: ["audio"],
        duration: 10,
        resolution: "1080p",
        generate_audio: false,
        watermark: true,
    },
    "the standard model payload must keep only its supported controls",
);

assert.deepEqual(parseSeedanceVideoTaskState({ id: "task-1", status: "queued" }), { status: "pending" });
assert.deepEqual(parseSeedanceVideoTaskState({ id: "task-1", status: "completed", video: { url: "https://example.test/video.mp4" } }), {
    status: "completed",
    result: { url: "https://example.test/video.mp4", mimeType: "video/mp4" },
});
assert.deepEqual(parseSeedanceVideoTaskState({ code: 0, data: { task_id: "task-2", status: "succeeded", content: { video_url: "https://example.test/legacy.mp4" } } }), {
    status: "completed",
    result: { url: "https://example.test/legacy.mp4", mimeType: "video/mp4" },
});
assert.deepEqual(parseSeedanceVideoTaskState({ id: "task-3", status: "failed", error: { message: "content moderated" } }), {
    status: "failed",
    error: "content moderated",
});

const serviceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../src/app/api/gateway/[...path]/route.ts", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const settingsRouteSource = readFileSync(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");

assert.match(serviceSource, /\/videos\/generations/, "TokAxis Seedance must use the plural async route");
assert.match(serviceSource, /buildTokaxisSeedanceVideoPayload/, "TokAxis Seedance requests must use the model-specific payload builder");
assert.match(proxySource, /isTokaxisAsyncVideoModel/, "the proxy must isolate async TokAxis video models from the legacy Grok rewrite");
assert.match(proxySource, /videos\\\/generations\(\?:\\\/\[\^\/\]\+\)\?/, "the proxy must allow Seedance polling paths");
const fallbackModelsBlock = configSource.match(/const TOKAXIS_FALLBACK_MODELS = \[([\s\S]*?)\n\];/)?.[1] ?? "";
assert.doesNotMatch(fallbackModelsBlock, /TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS/, "withdrawn Seedance models must stay out of the client fallback registry");
assert.match(configSource, /TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS\.map\(\(model\) => model\.toLowerCase\(\)\)/, "persisted Seedance selections must be filtered during migration");
assert.doesNotMatch(settingsRouteSource, /TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS/, "withdrawn Seedance models must stay out of the server fallback registry");

console.log("Seedance video model regression checks passed");
