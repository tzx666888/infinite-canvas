import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { CanvasCommerceVideoPlan } from "../src/app/(user)/canvas/types";
import { compileVideoBeatPrompt, compileVideoPrompt } from "../src/app/(user)/canvas/utils/video-prompt-compiler";
import { buildStoryboardVideoConstraintPrompt, GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, STORYBOARD_DIRECTED_VIDEO_MARKER, unwrapStoryboardVideoUserDirection } from "../src/lib/storyboard-video-constraints";
import { selectGrokReferenceVideoImagesWithPriority, supportsGrokVideoReferenceCount, videoAspectRatioForSize } from "../src/lib/video-model-settings";
import { buildStoryboardReviewSheetPrompt, normalizeGeneratedVideoPrompt, VIDEO_PROMPT_SYSTEM } from "../src/services/api/prompt-polish";

const apparelPlan: CanvasCommerceVideoPlan = {
    productCategory: "apparel",
    storyboardMode: "apparel",
    storyboardStyle: "lifestyle-montage",
    locationStrategy: "related-location-montage",
    directorBrief: "Keep the same woman and black bikini while moving through the beach, poolside, resort lounger, and tropical waterfall in that order.",
    plannedLocations: ["tropical beach", "resort poolside", "resort lounger", "tropical waterfall"],
    visualIdentity: "The same adult woman with the same face, hair, body proportions, and black string bikini.",
    forbiddenAdditions: ["cleaner bottle", "spray trigger", "packaging", "cleaning tools"],
    selectedHookType: "visual-shock",
    hookDescription: "A small wave reaches the adult model as the camera pushes toward the black bikini silhouette.",
    beats: [
        beat(0, "hook", "The adult woman reacts naturally to a small wave while wearing the same black string bikini.", "a sunny tropical beach"),
        beat(1, "pain", "She walks with a confident natural turn while keeping the same face, body proportions, and bikini design.", "the connected resort shoreline"),
        beat(2, "demo", "A closer angle shows the same bikini straps, triangular cups, material, and fit on the same adult model.", "a bright poolside terrace"),
        beat(3, "demo", "She moves naturally through falling water and the same black bikini remains unchanged.", "a tropical resort waterfall"),
        beat(4, "cta", "She finishes in a confident full-body pose with the same garment fully visible.", "a shaded poolside lounge"),
    ],
    enhancementWords: "Photorealistic daylight, stable anatomy, consistent face and garment identity.",
};

const reviewPrompt = buildStoryboardReviewSheetPrompt(apparelPlan);
const hiddenFrames = reviewPrompt.split("\n").filter((line) => line.startsWith("- Hidden storyboard instruction:"));
const beatOrder = hiddenFrames.map((line) => Number(line.match(/Follow beat (\d+)/)?.[1] ?? -1));

assert.equal(hiddenFrames.length, 12, "review sheet must contain exactly 12 hidden panel instructions");
assert.deepEqual(
    [...beatOrder].sort((a, b) => a - b),
    beatOrder,
    "panel beats must remain chronological",
);
assert.equal(beatOrder[0], 0, "first panel must use the first beat");
assert.equal(beatOrder.at(-1), 4, "last panel must use the final beat");
assert.match(reviewPrompt, /MODE LOCK: apparel/);
assert.match(reviewPrompt, /The garment or accessory already worn by the referenced person is the product/);
assert.match(reviewPrompt, /LOCATION STRATEGY: related-location-montage/);
assert.match(reviewPrompt, /at least three distinct but coherent location zones/);
assert.match(reviewPrompt, /BINDING USER DIRECTOR BRIEF/);
assert.match(reviewPrompt, /tropical beach -> resort poolside -> resort lounger -> tropical waterfall/);
assert.match(reviewPrompt, /tropical resort waterfall/);
assert.match(reviewPrompt, /No two adjacent panels may be near-duplicates/);
assert.doesNotMatch(reviewPrompt, /product jumps into the foreground as the obvious rescue solution/i);
assert.doesNotMatch(reviewPrompt, /visible product reaction, foam, mist/i);
assert.doesNotMatch(reviewPrompt, /final hero packshot plus clear result/i);
assert.equal(
    hiddenFrames.some((line) => /spray|cleaner|foam|wip(?:e|ing)/i.test(line)),
    false,
    "apparel panel instructions must not contain cleaning actions",
);

const grokPrompt = compileVideoPrompt(apparelPlan, {
    model: "grok",
    duration: 10,
    aspectRatio: "9:16",
    referenceMode: "i2v",
});

assert.match(grokPrompt, /short-form apparel video/i);
assert.match(grokPrompt, /black string bikini/i);
assert.match(grokPrompt, /never add a bottle, package, cleaner/i);
assert.match(grokPrompt, /related locations/i);
assert.match(grokPrompt, /tropical beach -> resort poolside -> resort lounger -> tropical waterfall/i);
assert.match(grokPrompt, /do not collapse every shot back into the first reference background/i);
assert.doesNotMatch(grokPrompt, /product pushed into the foreground as the rescue solution/i);
assert.doesNotMatch(grokPrompt, /sudden mess/i);

const firstClipPrompt = compileVideoBeatPrompt(apparelPlan, apparelPlan.beats![0], {
    model: "grok",
    duration: 6,
    aspectRatio: "9:16",
    referenceMode: "i2v",
});
const waterfallClipPrompt = compileVideoBeatPrompt(apparelPlan, apparelPlan.beats![3], {
    model: "grok",
    duration: 6,
    aspectRatio: "9:16",
    referenceMode: "i2v",
});
assert.notEqual(firstClipPrompt, waterfallClipPrompt, "each Phase 6 keyframe must receive its own beat prompt");
assert.match(firstClipPrompt, /this storyboard beat only/i);
assert.match(firstClipPrompt, /small wave/i);
assert.doesNotMatch(firstClipPrompt, /falling water/i);
assert.match(waterfallClipPrompt, /falling water/i);
assert.doesNotMatch(waterfallClipPrompt, /small wave/i);
assert.match(waterfallClipPrompt, /do not replay/i);

const productPlan: CanvasCommerceVideoPlan = {
    productCategory: "cleaning",
    storyboardMode: "product",
    visualIdentity: "The same green trigger bottle shown in the reference.",
    beats: [
        beat(0, "hook", "A visible grease mark appears beside the same referenced green trigger bottle."),
        beat(1, "demo", "A hand sprays the same referenced cleaner onto the grease mark."),
        beat(2, "cta", "The same referenced bottle stands beside the cleaned surface."),
    ],
};

const productReviewPrompt = buildStoryboardReviewSheetPrompt(productPlan);
assert.match(productReviewPrompt, /A hand sprays the same referenced cleaner/);
assert.match(productReviewPrompt, /MODE LOCK: product-led/);

const channel28ConstraintPrompt = buildStoryboardVideoConstraintPrompt({
    userDirection: "Keep the same green bottle, presenter, beach, and cleaning sequence.",
    duration: 10,
    sourcePanelCount: 12,
    attachedReferenceCount: 7,
    identityReferenceCount: 1,
    aspectRatio: "16:9",
    audioDirection: "Audio lock: use one consistent adult female voice.",
});
assert.equal(GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, "channel-28-v3-creative-montage");
assert.equal(channel28ConstraintPrompt.split(STORYBOARD_DIRECTED_VIDEO_MARKER).length - 1, 1, "constraint template must be emitted once");
assert.match(channel28ConstraintPrompt, /<IMAGE_1> is the exact product\/source identity lock/);
assert.match(channel28ConstraintPrompt, /<IMAGE_2> through <IMAGE_7> are ordered timeline anchors/);
assert.doesNotMatch(channel28ConstraintPrompt, /<IMAGE_8>/);
assert.match(channel28ConstraintPrompt, /Product lock:/);
assert.match(channel28ConstraintPrompt, /Shot lock:/);
assert.match(channel28ConstraintPrompt, /Human lock:/);
assert.match(channel28ConstraintPrompt, /polished 16:9/);
assert.doesNotMatch(channel28ConstraintPrompt, /polished 9:16/);

const accidentallyNestedPrompt = buildStoryboardVideoConstraintPrompt({
    userDirection: channel28ConstraintPrompt,
    duration: 10,
    sourcePanelCount: 12,
    attachedReferenceCount: 7,
    identityReferenceCount: 1,
    aspectRatio: "16:9",
    audioDirection: "Audio lock: use one consistent adult female voice.",
});
assert.equal(unwrapStoryboardVideoUserDirection(accidentallyNestedPrompt), "Keep the same green bottle, presenter, beach, and cleaning sequence.", "retry must recover the original user direction instead of nesting the template");

assert.equal(supportsGrokVideoReferenceCount("grok-imagine-video-1.5-fast", 0), true, "Fast text-to-video must remain available");
assert.equal(supportsGrokVideoReferenceCount("grok-imagine-video-1.5-fast", 1), true, "Fast single-image I2V must remain available");
assert.deepEqual(
    selectGrokReferenceVideoImagesWithPriority<string>(
        [],
        Array.from({ length: 12 }, (_, index) => `frame-${index + 1}`),
        "grok-imagine-video-1.5-fast",
    ),
    ["frame-1"],
    "Fast storyboard fallback must start from panel 1 instead of the middle of the story",
);
assert.deepEqual(
    selectGrokReferenceVideoImagesWithPriority(
        ["identity"],
        Array.from({ length: 12 }, (_, index) => `frame-${index + 1}`),
        "grok-imagine-video-1.5-fast",
    ),
    ["identity"],
    "Fast must preserve the upstream identity/product reference when one exists",
);

const identityOnlyPrompt = buildStoryboardVideoConstraintPrompt({
    userDirection: "Keep the product unchanged.",
    duration: 10,
    sourcePanelCount: 12,
    attachedReferenceCount: 1,
    identityReferenceCount: 1,
    aspectRatio: "9:16",
    audioDirection: "",
});
assert.doesNotMatch(identityOnlyPrompt, /<IMAGE_2>/, "one attached identity image must never produce a phantom IMAGE_2 role");
assert.doesNotMatch(identityOnlyPrompt, /Product lock:|Commerce rhythm:|product rescue|product hero/i, "identity-only Fast input must not receive generic product-commerce constraints");
assert.match(identityOnlyPrompt, /Entity lock:/, "identity-only Fast input must explicitly forbid unrelated products and props");
assert.equal(videoAspectRatioForSize("720x1280"), "9:16");
assert.equal(videoAspectRatioForSize("1280x720"), "16:9");
assert.equal(videoAspectRatioForSize("1024x1024"), "1:1");

assert.match(VIDEO_PROMPT_SYSTEM, /100-160 个英文单词/);
assert.match(VIDEO_PROMPT_SYSTEM, /第一处内容必须是具体运镜/);
assert.match(VIDEO_PROMPT_SYSTEM, /不要逐格复述全部面板/);
assert.match(VIDEO_PROMPT_SYSTEM, /切换 3-5 个语义相关地点/);
assert.doesNotMatch(VIDEO_PROMPT_SYSTEM, /120-220 词/);
assert.doesNotMatch(VIDEO_PROMPT_SYSTEM, /必须严格按照输入中的有序分镜推进/);

const verboseGeneratedPrompt = [
    "## Grok Version",
    "Slow dolly-in from a low beach-level angle, then cut to steady close-ups and product hero shots. On a sunny beach, an adult woman lifts a stained black swimsuit and reaches for the same bright green trigger bottle. Hands spray, brush, and rinse the fabric. End with the bottle beside the clean garment.",
    "Maintain visual continuity with the reference image, preserve subject appearance, color palette, product shape, label placement, and composition.",
    "Use the storyboard grid as ordered shot guidance only; recreate each panel as a clean full-frame shot.",
    "4K ultra HD, cinematic quality, natural body proportions, smooth continuous motion, no frame skipping.",
    "Negative prompt: no grid, no captions, no watermark.",
].join("\n");
const restoredShortPrompt = normalizeGeneratedVideoPrompt(verboseGeneratedPrompt);
assert.match(restoredShortPrompt, /^Slow dolly-in/);
assert.match(restoredShortPrompt, /End with the bottle beside the clean garment\.$/);
assert.doesNotMatch(restoredShortPrompt, /reference image|storyboard grid|4K ultra HD|Negative prompt/i);

const canvasClientSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
const hoverToolbarSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const promptPanelSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-node-prompt-panel.tsx", import.meta.url), "utf8");
const videoServiceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
assert.match(
    canvasClientSource,
    /storyboardReviewSheetWholeReferences\(nodeId, nodesRef\.current, connectionsRef\.current\)/,
    "storyboard video generation must restore the selected whole grid as its I2V shot map",
);
assert.match(
    canvasClientSource,
    /usesWholeStoryboardSheet \? \[\] : mergeReferenceImages\(generationContext\.referenceImages, storyboardIdentityImages\)/,
    "a connected whole grid must take priority over underlying identity-source fallbacks",
);
assert.match(
    canvasClientSource,
    /retriesWholeStoryboardSheet \? storyboardRetryWholeImages/,
    "retry must keep the connected whole grid instead of a stored identity image",
);
assert.match(canvasClientSource, /buildWholeStoryboardI2VPrompt/, "whole-grid I2V must use the compact channel-28-style prompt path");
assert.match(canvasClientSource, /ordered visual shot map, not as a visible opening frame/, "whole-grid prompt must not ask Grok to display the grid as the opening frame");
assert.match(canvasClientSource, /MANDATORY LOCATION SEQUENCE/, "whole-grid prompt must preserve the structured location order outside the compacted plan text");
assert.match(canvasClientSource, /Do not merge, substitute, omit, or revisit locations/, "whole-grid prompt must keep every planned location distinct");
assert.match(canvasClientSource, /compileVideoBeatPrompt\(plan, beat, videoPromptContext\)/, "Phase 6 must compile a distinct prompt for each beat");
assert.match(hoverToolbarSource, /label: "生成整片"/, "review sheets must expose the full-video workflow");
assert.match(hoverToolbarSource, /label: "生成分段"/, "plan nodes must distinguish clip generation from full-video generation");
assert.match(configStoreSource, /textModel: "tokaxis::gpt-5\.6-sol"/, "built-in text optimization model must default to GPT-5.6 Sol");
assert.match(configStoreSource, /shouldMigrateTokaxisDefaults \? defaultConfig\.textModel/, "existing persisted defaults must migrate to GPT-5.6 Sol");
assert.match(configStoreSource, /shouldMigrateTextModel \? \["gpt-5\.6-sol"\]/, "legacy channel model lists must receive GPT-5.6 Sol during migration");
assert.doesNotMatch(promptPanelSource, /tokaxis::gpt-5\.5/, "prompt polish UI must not retain a GPT-5.5 fallback");
assert.match(videoServiceSource, /referenceMode === "i2v" \? \{ image: referenceImages\[0\] \}/, "Fast single-image mode must send the explicit image field");
assert.match(videoServiceSource, /referenceMode === "r2v" \? \{ reference_images: referenceImages \}/, "reference-to-video mode must preserve reference_images");
assert.doesNotMatch(videoServiceSource, /reference_images:\s*referenceImages,\s*\n\s*};/, "video requests must not force every image input into reference_images");

console.log("storyboard prompt regression: passed");

function beat(index: number, phase: string, description: string, scene = "The same referenced environment.") {
    return {
        index,
        phase,
        timeRange: `${index * 3}-${(index + 1) * 3}s`,
        shotType: "medium",
        cameraMove: "slow push-in",
        description,
        eightElements: {
            subject: description,
            action: "Continue only the described action.",
            scene,
            lighting: "Consistent natural light.",
            camera: "Stable camera continuity.",
            style: "Photorealistic short-video frame.",
            quality: "High detail.",
            constraint: "Preserve exact identity and add no new entities.",
        },
    };
}
