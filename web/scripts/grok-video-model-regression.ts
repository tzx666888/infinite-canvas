import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fixedGrokVideoResolution, grokVideoReferenceImageLimit, normalizeReferenceVideoSeconds, selectGrokReferenceVideoImages, selectGrokReferenceVideoImagesWithPriority, supportsGrokVideoReferenceCount } from "../src/lib/video-model-settings";
import { buildCompactVideoProductScalePrompt } from "../src/lib/video-product-scale";

const fast = "grok-imagine-video-1.5-fast";
const preview = "grok-imagine-video-1.5-preview";
const hd = "grok-imagine-video-1.5-1080p";

assert.equal(grokVideoReferenceImageLimit(fast), 7);
assert.equal(grokVideoReferenceImageLimit(preview), 7);
assert.equal(grokVideoReferenceImageLimit(hd), 1);
assert.equal(fixedGrokVideoResolution(fast), "720");
assert.equal(fixedGrokVideoResolution(preview), "720");
assert.equal(fixedGrokVideoResolution(hd), "1080");

for (const count of [0, 1, 2, 7]) {
    assert.equal(supportsGrokVideoReferenceCount(fast, count), true, `Fast should accept ${count} reference images`);
}
assert.equal(supportsGrokVideoReferenceCount(fast, 8), false);
assert.equal(supportsGrokVideoReferenceCount(preview, 0), false);
assert.equal(supportsGrokVideoReferenceCount(preview, 1), true);
assert.equal(supportsGrokVideoReferenceCount(preview, 7), true);
assert.equal(supportsGrokVideoReferenceCount(preview, 8), false);
assert.equal(supportsGrokVideoReferenceCount(hd, 0), false);
assert.equal(supportsGrokVideoReferenceCount(hd, 1), true);
assert.equal(supportsGrokVideoReferenceCount(hd, 2), false);

assert.equal(normalizeReferenceVideoSeconds("15", fast, 0), "15");
assert.equal(normalizeReferenceVideoSeconds("15", fast, 1), "15");
assert.equal(normalizeReferenceVideoSeconds("15", fast, 2), "10");
assert.equal(normalizeReferenceVideoSeconds("15", fast, 7), "10");

const references = Array.from({ length: 8 }, (_, index) => index + 1);
assert.deepEqual(selectGrokReferenceVideoImages(references.slice(0, 7), fast), references.slice(0, 7));
assert.equal(selectGrokReferenceVideoImages(references, fast).length, 7);
assert.deepEqual(selectGrokReferenceVideoImagesWithPriority(references, [], fast), references, "direct Fast references must not be silently truncated before validation");
assert.deepEqual(selectGrokReferenceVideoImagesWithPriority(references.slice(0, 2), [], hd), references.slice(0, 2), "direct 1080p references must reach exact-one validation");
assert.equal(buildCompactVideoProductScalePrompt("auto"), "");
assert.match(buildCompactVideoProductScalePrompt("handheld"), /hand-sized as shown in the keyframe/i);
assert.ok(buildCompactVideoProductScalePrompt("handheld").split(/\s+/).length < 30, "compiled video prompts need a compact scale lock");

const videoServiceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const settingsPanelSource = readFileSync(new URL("../src/components/video-settings-panel.tsx", import.meta.url), "utf8");
const referenceConfigSource = readFileSync(new URL("../src/app/(user)/canvas/utils/video-reference-model.ts", import.meta.url), "utf8");
assert.match(videoServiceSource, /const fixedResolution = fixedGrokVideoResolution\(model\)/, "request payload must enforce each Grok model's fixed output resolution");
assert.match(videoServiceSource, /VIDEO_POLL_TRANSIENT_RETRY_LIMIT/, "video polling must survive a short proxy or deployment interruption");
assert.match(videoServiceSource, /buildCompactVideoProductScalePrompt\(productScaleMode\)/, "compiled video prompts must not regain the long legacy scale template");
assert.match(videoServiceSource, /if \(url && !isProtectedVideoContentUrl\(url\)\)/, "protected task results must not be returned directly to the browser");
assert.match(videoServiceSource, /aiApiUrl\(config, `\/videos\/\$\{task\.id\}\/content`\)/, "completed task content must be downloaded through the authenticated canvas proxy");
assert.match(settingsPanelSource, /fixedResolution \? null : <ResolutionInput/, "Grok settings must not expose a fake custom-resolution input");
assert.match(referenceConfigSource, /vquality: fixedGrokVideoResolution/, "reference-video config must preserve 1080p for the 1080p model");

console.log("Grok video model regression checks passed");
