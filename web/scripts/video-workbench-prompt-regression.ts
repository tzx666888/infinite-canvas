import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compileVideoWorkbenchPrompt, hasWorkbenchSpokenScript, VIDEO_WORKBENCH_PROMPT_MARKER, workbenchShotCount, workbenchSpeechWordRange } from "../src/lib/video-workbench-prompt.ts";

const direction =
    'A steady face-visible medium shot opens on the same adult creator holding the product at chest height. She gives one relaxed reaction, then a clean cut shows the product used at natural scale before a final shared hero shot. Spoken script: "I did not expect this to fit my routine so easily, but now I reach for it every day."';

const fastPrompt = compileVideoWorkbenchPrompt(direction, {
    mode: "commerce",
    model: "grok-imagine-video-1.5-fast",
    duration: 15,
    aspectRatio: "9:16",
    referenceMode: "i2v",
    referenceCount: 1,
    sourcePrompt: "真人带货，自然口播",
});
assert.ok(fastPrompt.startsWith(VIDEO_WORKBENCH_PROMPT_MARKER));
assert.match(fastPrompt, /exact opening-frame/i);
assert.match(fastPrompt, /never silent or music-only/i);
assert.match(fastPrompt, /Lip-sync only the opening sentence/i);
assert.match(fastPrompt, /Spoken script:/i);
assert.equal(hasWorkbenchSpokenScript(fastPrompt), true);
assert.ok(fastPrompt.split(/\s+/).length <= 180, "Grok workbench prompt must stay within the proven 100-180 word range");

const previewPrompt = compileVideoWorkbenchPrompt(direction, {
    mode: "commerce",
    model: "grok-imagine-video-1.5-preview",
    duration: 10,
    aspectRatio: "16:9",
    referenceMode: "r2v",
    referenceCount: 3,
    sourcePrompt: "沙滩真人带货",
});
assert.match(previewPrompt, /all 3 images as ordered identity, wardrobe, product, and scene assets/i);
assert.match(previewPrompt, /never blend them/i);
assert.doesNotMatch(previewPrompt, /exact opening-frame/i);

const hdPrompt = compileVideoWorkbenchPrompt(direction, {
    mode: "commerce",
    model: "grok-imagine-video-1.5-1080p",
    duration: 6,
    aspectRatio: "16:9",
    referenceMode: "i2v",
    referenceCount: 1,
    sourcePrompt: "真人带货",
});
assert.match(hdPrompt, /exactly 6 seconds/i);
assert.match(hdPrompt, /exact opening-frame/i);
assert.match(hdPrompt, /Preserve the adult face, hair, wardrobe, body proportions/i);

const creativePrompt = compileVideoWorkbenchPrompt("A silent tracking shot follows the adult subject through the scene with only natural surf.", {
    mode: "creative",
    model: "grok-imagine-video-1.5-fast",
    duration: 10,
    aspectRatio: "9:16",
    referenceMode: "t2v",
    referenceCount: 0,
    sourcePrompt: "静音，只要环境音",
});
assert.doesNotMatch(creativePrompt, /never silent or music-only/i);
assert.match(creativePrompt, /Do not invent dialogue/i);

assert.deepEqual(workbenchSpeechWordRange(6), [10, 14]);
assert.deepEqual(workbenchSpeechWordRange(10), [18, 24]);
assert.deepEqual(workbenchSpeechWordRange(15), [26, 34]);
assert.equal(workbenchShotCount(6), 2);
assert.equal(workbenchShotCount(10), 3);
assert.equal(workbenchShotCount(15), 4);

const videoServiceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const workbenchPageSource = readFileSync(new URL("../src/app/(user)/video/page.tsx", import.meta.url), "utf8");
const polishSource = readFileSync(new URL("../src/services/api/prompt-polish.ts", import.meta.url), "utf8");
assert.match(videoServiceSource, /rawPrompt\.includes\(VIDEO_WORKBENCH_PROMPT_MARKER\)/, "complete workbench prompts must bypass the legacy generic wrapper");
assert.match(workbenchPageSource, /optimizeVideoWorkbenchPrompt\(/, "the workbench must run intelligent direction before submitting a Grok task");
assert.match(workbenchPageSource, /\{ label: "真人带货", value: "commerce" \}/, "real-person commerce must remain an enabled workbench mode");
assert.match(workbenchPageSource, /\{ label: "自由创作", value: "creative" \}/, "free creative generation must remain available");
assert.match(polishSource, /const DEFAULT_POLISH_MODEL = "tokaxis::gpt-5\.6-sol"/, "workbench direction must use the configured 5.6-sol default");

console.log("Video workbench prompt regression checks passed");
