import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    fixedVideoDurationOptions,
    fixedVideoResolution,
    GOOGLE_VIDEO_MODEL_IDS,
    googleVideoReferenceMode,
    isGoogleVideoModel,
    normalizeReferenceVideoSeconds,
    supportsGoogleVideoReferenceCount,
    videoReferenceImageLimit,
} from "../src/lib/video-model-settings.ts";

const t2v = "veo_3_1_t2v_fast_portrait";
const i2v = "veo_3_1_i2v_s_fast_portrait_fl";
const r2v = "veo_3_1_r2v_fast_portrait";

assert.equal(GOOGLE_VIDEO_MODEL_IDS.length, 9);
for (const model of GOOGLE_VIDEO_MODEL_IDS) assert.equal(isGoogleVideoModel(`tokaxis::${model}`), true, `${model} must be recognized as a Google video model`);

assert.equal(googleVideoReferenceMode(t2v), "t2v");
assert.equal(googleVideoReferenceMode(i2v), "i2v");
assert.equal(googleVideoReferenceMode(r2v), "r2v");
assert.equal(videoReferenceImageLimit(t2v), 0);
assert.equal(videoReferenceImageLimit(i2v), 2);
assert.equal(videoReferenceImageLimit(r2v), 3);
assert.equal(supportsGoogleVideoReferenceCount(t2v, 0), true);
assert.equal(supportsGoogleVideoReferenceCount(t2v, 1), false);
assert.equal(supportsGoogleVideoReferenceCount(i2v, 1), true);
assert.equal(supportsGoogleVideoReferenceCount(i2v, 2), true);
assert.equal(supportsGoogleVideoReferenceCount(i2v, 3), false);
assert.equal(supportsGoogleVideoReferenceCount(r2v, 1), true);
assert.equal(supportsGoogleVideoReferenceCount(r2v, 3), true);
assert.equal(supportsGoogleVideoReferenceCount(r2v, 4), false);
assert.equal(supportsGoogleVideoReferenceCount("omni", 0), true);
assert.equal(supportsGoogleVideoReferenceCount("omni_portrait", 1), true);
assert.equal(supportsGoogleVideoReferenceCount("omni", 3), true);
assert.equal(supportsGoogleVideoReferenceCount("omni_portrait", 4), false);
assert.equal(videoReferenceImageLimit("omni"), 3);
assert.equal(googleVideoReferenceMode("omni", 0), "t2v");
assert.equal(googleVideoReferenceMode("omni_portrait", 1), "r2v");
assert.deepEqual(fixedVideoDurationOptions(t2v), [4, 6, 15]);
assert.deepEqual(fixedVideoDurationOptions("omni"), [10]);
assert.equal(normalizeReferenceVideoSeconds("15", "omni", 0), "10");
assert.equal(fixedVideoResolution(r2v), "720");

const serviceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const settingsRouteSource = readFileSync(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
assert.match(serviceSource, /new FormData\(\)/, "Flow video requests must be multipart");
assert.match(serviceSource, /aiApiUrl\(config, "\/videos"\)/, "Flow video creation must use the async /videos contract");
assert.doesNotMatch(serviceSource, /aiApiUrl\(config, "\/videos\/generations"\)/, "Google video must not use the legacy Grok endpoint");
assert.match(serviceSource, /body\.append\("input_reference", file\)/, "reference images must be uploaded as multipart files");
assert.match(configSource, /videoModel: "tokaxis::veo_3_1_i2v_s_fast_portrait_fl"/, "TokAxis default must migrate away from Grok");
assert.match(configSource, /\.\.\.GOOGLE_VIDEO_MODEL_IDS/, "TokAxis fallback must expose all Google models");
assert.match(settingsRouteSource, /\.\.\.GOOGLE_VIDEO_MODEL_IDS/, "settings fallback must expose all Google models");
assert.match(canvasSource, /model: "veo"/, "storyboard video prompts must compile for Veo");

console.log("Google video model regression checks passed");
