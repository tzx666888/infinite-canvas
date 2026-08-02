import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    fixedGoogleVideoDurationOptions,
    fixedGoogleVideoResolution,
    GOOGLE_VIDEO_MODEL_IDS,
    googleVideoEntryMode,
    googleVideoEntryReferenceImageLimit,
    googleVideoReferenceImageLimit,
    googleVideoReferenceMode,
    isGoogleVeoOfficialExtendDuration,
    isGoogleVideoModel,
    normalizeGoogleVideoSeconds,
    resolveGoogleVideoRouteModelId,
    supportsGoogleVideoReferenceCount,
} from "../src/lib/video-providers/google-video.ts";

const t2v = "veo_3_1_t2v_fast_portrait";
const i2v = "veo_3_1_i2v_s_fast_portrait_fl";
const r2v = "veo_3_1_r2v_fast_portrait";

assert.equal(GOOGLE_VIDEO_MODEL_IDS.length, 9);
for (const model of GOOGLE_VIDEO_MODEL_IDS) assert.equal(isGoogleVideoModel(`tokaxis::${model}`), true, `${model} must be recognized as a Google video model`);

assert.equal(googleVideoReferenceMode(t2v), "t2v");
assert.equal(googleVideoReferenceMode(i2v), "i2v");
assert.equal(googleVideoReferenceMode(r2v), "r2v");
assert.equal(googleVideoReferenceImageLimit(t2v), 0);
assert.equal(googleVideoReferenceImageLimit(i2v), 2);
assert.equal(googleVideoReferenceImageLimit(r2v), 3);
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
assert.equal(googleVideoReferenceImageLimit("omni"), 3);
assert.equal(googleVideoReferenceMode("omni", 0), "t2v");
assert.equal(googleVideoReferenceMode("omni_portrait", 1), "r2v");
assert.deepEqual(fixedGoogleVideoDurationOptions(t2v), [4, 6, 8, 15]);
assert.deepEqual(fixedGoogleVideoDurationOptions(r2v), [8]);
assert.deepEqual(fixedGoogleVideoDurationOptions("omni"), [10]);
assert.equal(normalizeGoogleVideoSeconds("15", t2v), "15");
assert.equal(normalizeGoogleVideoSeconds("16", t2v), "15");
assert.equal(normalizeGoogleVideoSeconds("16", r2v), "8");
assert.equal(normalizeGoogleVideoSeconds("15", "omni"), "10");
assert.equal(isGoogleVeoOfficialExtendDuration("15", t2v), true);
assert.equal(isGoogleVeoOfficialExtendDuration("15", i2v), true);
assert.equal(isGoogleVeoOfficialExtendDuration("15", r2v), false);
assert.equal(isGoogleVeoOfficialExtendDuration("15", "omni"), false);
assert.equal(fixedGoogleVideoResolution(r2v), "1080");
assert.equal(fixedGoogleVideoResolution(t2v, "15"), "720");
assert.equal(fixedGoogleVideoResolution("omni_portrait"), "720");

assert.equal(googleVideoEntryMode(t2v), "veo-auto");
assert.equal(googleVideoEntryMode(i2v), "veo-auto");
assert.equal(googleVideoEntryMode(r2v), "veo-r2v");
assert.equal(googleVideoEntryMode("omni"), "omni");
assert.equal(googleVideoEntryReferenceImageLimit(t2v), 2);
assert.equal(googleVideoEntryReferenceImageLimit(r2v), 3);
assert.equal(resolveGoogleVideoRouteModelId(i2v, 0, "9:16"), "veo_3_1_t2v_fast_portrait");
assert.equal(resolveGoogleVideoRouteModelId(t2v, 1, "16:9"), "veo_3_1_i2v_s_fast_fl");
assert.equal(resolveGoogleVideoRouteModelId(t2v, 2, "9:16"), "veo_3_1_i2v_s_fast_portrait_fl");
assert.throws(() => resolveGoogleVideoRouteModelId(t2v, 3, "9:16"), /切换到 Veo 3\.1 多参考/);
assert.throws(() => resolveGoogleVideoRouteModelId(r2v, 0, "16:9"), /需要连接 1–3 张参考图/);
assert.equal(resolveGoogleVideoRouteModelId(r2v, 3, "16:9"), "veo_3_1_r2v_fast_landscape");
assert.equal(resolveGoogleVideoRouteModelId("omni", 0, "9:16"), "omni_portrait");
assert.equal(resolveGoogleVideoRouteModelId("omni_portrait", 3, "16:9"), "omni");

const serviceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const googleAdapterSource = readFileSync(new URL("../src/services/api/video/google-flow-adapter.ts", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const settingsRouteSource = readFileSync(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
const routingSource = readFileSync(new URL("../src/lib/google-video-routing.ts", import.meta.url), "utf8");
const pickerSource = readFileSync(new URL("../src/components/model-picker.tsx", import.meta.url), "utf8");
assert.match(serviceSource, /createGoogleFlowVideoTaskRequest/, "video orchestration must delegate Google requests to the Google adapter");
assert.match(serviceSource, /aiApiUrl\(config, "\/videos"\)/, "Flow video creation must use the async /videos contract");
assert.doesNotMatch(serviceSource, /aiApiUrl\(config, "\/videos\/generations"\)/, "Google video must not use the legacy Grok endpoint");
assert.match(googleAdapterSource, /new FormData\(\)/, "Flow video requests must be multipart");
assert.match(googleAdapterSource, /body\.append\("input_reference", file\)/, "reference images must be uploaded as multipart files");
assert.match(googleAdapterSource, /body\.append\("seconds", input\.seconds\)/, "Google video duration must be sent explicitly");
assert.match(googleAdapterSource, /body\.append\("resolution_name", input\.resolution\)/, "Google video resolution must be sent explicitly");
assert.match(configSource, /videoModel: DEFAULT_GOOGLE_VIDEO_MODEL/, "TokAxis default must come from the isolated Google provider contract");
assert.match(configSource, /video-providers\/google-video/, "TokAxis defaults must import only the Google provider contract");
assert.match(configSource, /\.\.\.GOOGLE_VIDEO_MODEL_IDS/, "TokAxis fallback must expose all Google models");
assert.match(settingsRouteSource, /video-providers\/google-video/, "settings fallback must import only the Google provider contract");
assert.match(settingsRouteSource, /\.\.\.GOOGLE_VIDEO_MODEL_IDS/, "settings fallback must expose all Google models");
assert.match(canvasSource, /model: "veo"/, "storyboard video prompts must compile for Veo");
assert.match(routingSource, /resolveGoogleVideoRouteModelId/, "all Google requests must use the deterministic route matrix");
assert.match(pickerSource, /compactVideoModelPickerOptions/, "the video picker must collapse raw model IDs into capability entries");

console.log("Google video model regression checks passed");
