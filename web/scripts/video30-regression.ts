import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isTokaxisVideo30Model, isVideo30Config, normalizeVideo30Ratio, VIDEO30_DURATION_OPTIONS, VIDEO30_REFERENCE_LIMITS } from "../src/lib/video30.ts";
import { parseSeedanceVideoTaskState } from "../src/services/api/video/seedance-adapter.ts";

assert.equal(isTokaxisVideo30Model("tokaxis::sd30"), true);
assert.equal(isVideo30Config({ model: "tokaxis::sd30", videoModel: "" }), true);
assert.deepEqual(VIDEO30_DURATION_OPTIONS, [30]);
assert.equal(VIDEO30_REFERENCE_LIMITS.images, 9);
assert.equal(normalizeVideo30Ratio("FB-9:16"), "16:9", "delivery presets are normalized by the API layer from facebookMediaPreset");
assert.equal(normalizeVideo30Ratio("9:16"), "9:16");
assert.equal(normalizeVideo30Ratio("21:9"), "21:9");

assert.deepEqual(parseSeedanceVideoTaskState({ id: "task-30", status: "queued" }), { status: "pending" });
assert.deepEqual(parseSeedanceVideoTaskState({ id: "task-30", status: "completed", video: { url: "https://example.test/video.mp4" } }), {
    status: "completed",
    result: { url: "https://example.test/video.mp4", mimeType: "video/mp4" },
});

const preflightSource = readFileSync(new URL("../src/app/(user)/canvas/utils/video-generation-preflight.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const gatewaySource = readFileSync(new URL("../src/app/api/gateway/[...path]/route.ts", import.meta.url), "utf8");
const billingSource = readFileSync(new URL("../src/lib/gateway/billing.ts", import.meta.url), "utf8");
assert.match(preflightSource, /if \(isVideo30Config\(selectedConfig\)\)/, "sd30 must have a dedicated normalization branch");
assert.match(preflightSource, /if \(isVideo30Config\(input\.config\)\)/, "sd30 must have a dedicated validation branch");
assert.match(serviceSource, /if \(isVideo30Config\(configuredRequest\)\)/, "sd30 must route before the generic Google fallback");
assert.match(serviceSource, /provider: "video30"/, "sd30 tasks must use the extended polling budget");
assert.match(serviceSource, /seconds: "30"/, "sd30 requests must pin the upstream duration");
assert.match(gatewaySource, /minimaxh3-2k", "sd30"/, "gateway must preserve sd30 async requests");
assert.match(billingSource, /minimaxh3-2k", "sd30"/, "billing reconciliation must poll sd30 task paths");

console.log("30-second video model regression checks passed");
