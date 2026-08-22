import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildAudioSpeechRequest } from "../src/lib/audio-generation.ts";
import { buildTokaxisSeedanceVideoPayload } from "../src/lib/seedance-video.ts";
import { buildTokaxisGoogleImageChatRequest, resolveTokaxisGoogleImageConfig } from "../src/lib/tokaxis-google-image.ts";
import { buildGoogleFlowVideoRequestBody } from "../src/services/api/video/google-flow-adapter.ts";

const fixedSeedance = buildTokaxisSeedanceVideoPayload({
    model: "Seedance 2.0-fast-720p",
    prompt: "move",
    images: ["image"],
    videos: ["video"],
    audios: ["audio"],
    duration: "10",
    resolution: "1080p",
    ratio: "9:16",
    generateAudio: false,
    watermark: false,
});
assert.deepEqual(Object.keys(fixedSeedance).sort(), ["aspect_ratio", "duration", "images", "model", "prompt", "resolution"]);
assert.equal("generate_audio" in fixedSeedance, false);
assert.equal("videos" in fixedSeedance, false);
assert.equal("audios" in fixedSeedance, false);
assert.equal("watermark" in fixedSeedance, false);

const standardSeedance = buildTokaxisSeedanceVideoPayload({
    model: "qy-seedance-2.0",
    prompt: "move",
    images: ["image"],
    videos: ["video"],
    audios: ["audio"],
    duration: "8",
    resolution: "1080p",
    ratio: "adaptive",
    generateAudio: false,
    watermark: true,
});
assert.deepEqual(Object.keys(standardSeedance).sort(), ["audios", "duration", "generate_audio", "images", "model", "prompt", "resolution", "videos", "watermark"]);
assert.equal(standardSeedance.generate_audio, false);

const googleImage = buildTokaxisGoogleImageChatRequest({
    model: "gemini-3.1-flash-image-4k",
    messages: [{ role: "user", content: "image" }],
    imageConfig: resolveTokaxisGoogleImageConfig("gemini-3.1-flash-image-4k", "16:9", "high"),
});
assert.deepEqual(Object.keys(googleImage).sort(), ["image_config", "messages", "model", "stream"]);
assert.equal("quality" in googleImage, false);
assert.equal("output_format" in googleImage, false);
assert.equal("temperature" in googleImage, false);

const tts1 = buildAudioSpeechRequest({ model: "tts-1", input: "hello", voice: "alloy", format: "mp3", speed: "1", instructions: "whisper" });
assert.deepEqual(Object.keys(tts1).sort(), ["input", "model", "response_format", "speed", "voice"]);
assert.equal("instructions" in tts1, false);

const gptTts = buildAudioSpeechRequest({ model: "gpt-4o-mini-tts", input: "hello", voice: "coral", format: "wav", speed: "1.25", instructions: "warm" });
assert.deepEqual(Object.keys(gptTts).sort(), ["input", "instructions", "model", "response_format", "speed", "voice"]);
assert.equal(gptTts.instructions, "warm");

const googleVideo = buildGoogleFlowVideoRequestBody({
    model: "veo_3_1_t2v_fast_portrait",
    prompt: "move",
    seconds: "8",
    size: "720x1280",
    resolution: "1080",
    files: [],
});
assert.deepEqual(Array.from(googleVideo.keys()).sort(), ["model", "preset", "prompt", "resolution_name", "seconds", "size"], "Google/Omni requests must contain only the Flow multipart contract");

const imageServiceSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../src/app/api/gateway/[...path]/route.ts", import.meta.url), "utf8");
const upstreamAuthSource = readFileSync(new URL("../src/lib/gateway/upstream-auth.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");

assert.match(imageServiceSource, /buildTokaxisGoogleImageChatRequest/, "Google image requests must use their isolated body builder");
assert.match(proxySource, /unsupported_video_model/, "unknown video models must be rejected at the canvas proxy");
assert.match(upstreamAuthSource, /CANVAS_UPSTREAM_API_KEY/, "the private gateway must use only its server-side service credential upstream");
assert.doesNotMatch(upstreamAuthSource, /getCanvasUpstreamApiKey|saveCanvasUpstreamApiKey|internal\/canvas\/token/, "Canvas keys must never resolve to a customer station key");
assert.doesNotMatch(proxySource, /resolveStationUpstreamAuthorization|startsWith\(["']sk-/, "station keys must never enter the Canvas gateway");
assert.match(proxySource, /gateway-ip:.*requestAddress/, "the Canvas model gateway must have an independent per-IP rate limit");
assert.match(proxySource, /MAX_GATEWAY_BODY_BYTES/, "the Canvas model gateway must reject oversized request bodies before forwarding");
assert.match(configSource, /value\.startsWith\("vc_live_"\)/, "station Canvas keys must not be rewritten with a legacy sk- prefix before model sync");
assert.match(configSource, /startsWith\("sk-"\)\s*\?\s*TOKAXIS_STATION_BASE_URL/, "station keys must call NewAPI directly instead of crossing the Canvas gateway");
assert.doesNotMatch(settingsSource, /grok-imagine-image-lite/, "the server fallback must not expose an unavailable Grok image model");
assert.doesNotMatch(configSource, /"grok-imagine-image-lite"/, "the client fallback must not expose an unavailable Grok image model");

console.log("Model parameter isolation regression checks passed");
