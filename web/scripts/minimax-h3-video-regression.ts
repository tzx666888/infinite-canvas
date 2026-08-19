import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTokaxisMiniMaxH3Payload, isTokaxisMiniMaxH3VideoModel, normalizeMiniMaxH3AspectRatio, normalizeMiniMaxH3Duration, TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID, TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS } from "../src/lib/minimax-h3-video.ts";

assert.equal(isTokaxisMiniMaxH3VideoModel("tokaxis::MiniMax-H3-c4"), true);
assert.deepEqual(TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS, ["MiniMax-H3-c4", "MiniMaxH3-720p", "MiniMaxH3-2k"]);
assert.equal(isTokaxisMiniMaxH3VideoModel("tokaxis::MiniMaxH3-720p"), true);
assert.equal(isTokaxisMiniMaxH3VideoModel("tokaxis::MiniMaxH3-2k"), true);
assert.equal(normalizeMiniMaxH3Duration(4), 5);
assert.equal(normalizeMiniMaxH3Duration(11.8), 11);
assert.equal(normalizeMiniMaxH3Duration(16), 15);
assert.equal(normalizeMiniMaxH3AspectRatio("720x1280"), "9:16");
assert.equal(normalizeMiniMaxH3AspectRatio("1280x720"), "16:9");

assert.deepEqual(
    buildTokaxisMiniMaxH3Payload({
        prompt: "cinematic sunrise",
        images: ["image"],
        audios: ["audio"],
        duration: "7",
        size: "720x1280",
        generateAudio: true,
    }),
    {
        model: TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID,
        prompt: "cinematic sunrise",
        images: ["image"],
        audios: ["audio"],
        duration: 7,
        resolution: "1440P",
        aspect_ratio: "9:16",
        generate_audio: true,
    },
);
assert.throws(() => buildTokaxisMiniMaxH3Payload({ prompt: "move", audios: ["audio"], duration: 5, size: "16:9", generateAudio: true }), /需要同时提供参考图/);
assert.equal(buildTokaxisMiniMaxH3Payload({ model: "tokaxis::MiniMaxH3-720p", prompt: "move", duration: 5, size: "16:9", generateAudio: false }).model, "MiniMaxH3-720p");
assert.equal(buildTokaxisMiniMaxH3Payload({ model: "tokaxis::MiniMaxH3-720p", prompt: "move", duration: 5, size: "16:9", generateAudio: false }).resolution, "768P");
assert.equal(buildTokaxisMiniMaxH3Payload({ model: "tokaxis::MiniMaxH3-2k", prompt: "move", duration: 5, size: "16:9", generateAudio: false }).model, "MiniMaxH3-2k");
assert.equal(buildTokaxisMiniMaxH3Payload({ model: "tokaxis::MiniMaxH3-2k", prompt: "move", duration: 5, size: "16:9", generateAudio: false }).resolution, "2K");

const proxySource = readFileSync(new URL("../src/app/api/gateway/[...path]/route.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/lib/video-model-settings.ts", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
assert.match(proxySource, /minimax-h3-c4/);
assert.match(proxySource, /minimaxh3-720p/);
assert.match(proxySource, /minimaxh3-2k/);
assert.match(serviceSource, /createMiniMaxH3Task/);
assert.match(serviceSource, /buildTokaxisMiniMaxH3Payload/);
assert.match(settingsSource, /isTokaxisMiniMaxH3VideoModel/);
assert.match(settingsSource, /resolution === "768P"/);
assert.match(settingsSource, /resolution === "2K"/);
const fallbackModelsBlock = configStoreSource.match(/const TOKAXIS_FALLBACK_MODELS\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? "";

assert.match(fallbackModelsBlock, /TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS/);
assert.doesNotMatch(fallbackModelsBlock, /TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS/);
assert.match(configStoreSource, /\.\.\.TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS\.map\(\(model\) => model\.toLowerCase\(\)\)/);

console.log("MiniMax H3 video regression checks passed");
