import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CanvasNodeType, type CanvasCommerceVideoPlan, type CanvasConnection, type CanvasNodeData } from "../src/app/(user)/canvas/types";
import {
    compileStoryboardAudioDirection,
    compileVideoBeatPrompt,
    compileVideoPrompt,
    hasCompleteStoryboardAudioPlan,
    resolveStoryboardMode,
    resolveStoryboardVideoPlan,
    selectBeatsForDuration,
    selectStoryboardLocationsForDuration,
    storyboardAudioScriptForDuration,
    storyboardShotBudget,
} from "../src/app/(user)/canvas/utils/video-prompt-compiler";
import { buildStoryboardVideoConstraintPrompt, GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, STORYBOARD_DIRECTED_VIDEO_MARKER, unwrapStoryboardVideoUserDirection } from "../src/lib/storyboard-video-constraints";
import { grokVideoReferenceMode, selectGrokReferenceVideoImagesWithPriority, supportsGrokVideoReferenceCount, videoAspectRatioForSize } from "../src/lib/video-model-settings";
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
    audioPlan: {
        mode: "mixed",
        language: "English",
        voice: "One natural energetic adult female voice",
        script: "Wow, that wave was unexpected. This bikini feels so secure, perfect for relaxing in the sun; the ties stay in place all day, so get yours and feel the comfort.",
        scriptsByDuration: {
            "6": "That wave woke me up. This bikini stays comfortable wherever I wander.",
            "10": "That wave woke me up. This bikini feels secure, moves naturally, and stays comfortable from the shoreline to the pool.",
            "15": "Wow, that wave was unexpected. This bikini feels so secure, perfect for relaxing in the sun; the ties stay in place all day, so get yours and feel the comfort.",
        },
    },
    beats: [
        { ...beat(0, "hook", "The adult woman reacts naturally to a small wave while wearing the same black string bikini.", "a sunny tropical beach"), spokenLine: "That wave surprised me!" },
        { ...beat(1, "pain", "She faces the camera and speaks while walking naturally with the same face, body proportions, and bikini design.", "the connected resort shoreline"), spokenLine: "This secure fit moves comfortably." },
        beat(2, "demo", "A closer angle shows the same bikini straps, triangular cups, material, and fit on the same adult model.", "a bright poolside terrace"),
        beat(3, "demo", "She moves naturally through falling water and the same black bikini remains unchanged.", "a tropical resort waterfall"),
        { ...beat(4, "cta", "She faces the camera and delivers the final line with the same garment fully visible.", "a shaded poolside lounge"), spokenLine: "Enjoy every resort moment." },
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
assert.match(grokPrompt, /sunny tropical beach -> a bright poolside terrace -> a shaded poolside lounge/i);
assert.match(grokPrompt, /hard cut to/i);
assert.doesNotMatch(grokPrompt, /tropical waterfall/i, "10-second execution must omit lower-priority locations instead of squeezing every 15-second beat into the video");
assert.match(grokPrompt, /do not .*collapse every shot back into the first background/i);
assert.doesNotMatch(grokPrompt, /product pushed into the foreground as the rescue solution/i);
assert.doesNotMatch(grokPrompt, /sudden mess/i);

const legacyPanelDirectionPrompt = compileVideoPrompt(
    {
        ...apparelPlan,
        beats: apparelPlan.beats?.map((item) =>
            item.index === 1
                ? { ...item, description: "Continue in the visible panel order as the woman turns toward the shoreline." }
                : item.index === 4
                  ? { ...item, description: "At the wet sand, preserve the final four-panel progression: the woman settles beside the foam." }
                  : item,
        ),
    },
    { model: "grok", duration: 15, aspectRatio: "9:16", referenceMode: "i2v" },
);
assert.doesNotMatch(legacyPanelDirectionPrompt, /visible panel order|four-panel progression/i, "legacy panel choreography must not make Grok replay the grid pose by pose");
assert.match(legacyPanelDirectionPrompt, /finish with the woman settles beside the foam/i);

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
assert.match(waterfallClipPrompt, /off-screen voiceover/i);
assert.match(waterfallClipPrompt, /do not make a visible presenter fake the narration/i);
assert.match(firstClipPrompt, /generate clear audible speech/i);
assert.match(firstClipPrompt, /That wave surprised me!/i);
assert.match(firstClipPrompt, /synchronized lips/i);

const wholeAudioDirection = compileStoryboardAudioDirection(apparelPlan, apparelPlan.directorBrief, 15);
assert.match(wholeAudioDirection, /never return silent or music-only video/i);
assert.match(wholeAudioDirection, /natural English/i);
assert.match(wholeAudioDirection, /adult female voice/i);
assert.match(wholeAudioDirection, /Mixed delivery:/i);
assert.match(wholeAudioDirection, /says only the short first sentence/i);
assert.match(wholeAudioDirection, /After one breath/i);
assert.match(wholeAudioDirection, /Say this exact script once, conversationally/i);
assert.match(wholeAudioDirection, /Wow, that wave was unexpected/i);
assert.doesNotMatch(wholeAudioDirection, /That wave woke me up/i, "15-second generation must use the 15-second script variant");
assert.doesNotMatch(wholeAudioDirection, /cue timing|speech schedule|\d+(?:\.\d+)?-\d+(?:\.\d+)?s/i);

const legacyApparelPlan: CanvasCommerceVideoPlan = {
    ...apparelPlan,
    audioPlan: undefined,
    beats: apparelPlan.beats?.map(({ spokenLine: _spokenLine, ...item }) => item),
};
assert.equal(hasCompleteStoryboardAudioPlan(apparelPlan), true, "a saved exact whole-video script is complete");
assert.equal(hasCompleteStoryboardAudioPlan(apparelPlan, 10), true, "a saved duration-specific script is complete for its matching model duration");
assert.equal(hasCompleteStoryboardAudioPlan(legacyApparelPlan), false, "legacy plans without a script must be enriched before a billable whole-video request");
assert.equal(hasCompleteStoryboardAudioPlan({ ...apparelPlan, audioPlan: { ...apparelPlan.audioPlan, scriptsByDuration: undefined } }, 10), false, "a 15-second base script must not be reused by a 10-second model");
assert.match(storyboardAudioScriptForDuration(apparelPlan, 10), /That wave woke me up/i);
assert.equal(storyboardShotBudget(6), 2);
assert.equal(storyboardShotBudget(10), 3);
assert.equal(storyboardShotBudget(15), 4);
assert.deepEqual(
    selectBeatsForDuration(apparelPlan.beats, 15)?.map((beat) => beat.index),
    [0, 1, 3, 4],
    "15-second whole-grid video must use four stable story stages instead of replaying every panel pose",
);
assert.deepEqual(selectStoryboardLocationsForDuration(apparelPlan, 10), ["a sunny tropical beach", "a bright poolside terrace", "a shaded poolside lounge"]);
const legacyPlanNode: CanvasNodeData = {
    id: "legacy-plan",
    type: CanvasNodeType.Text,
    title: "Legacy plan",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: { storyboardPlanId: "plan-1", commerceVideoPlan: apparelPlan },
};
const blankLegacyReviewNode: CanvasNodeData = {
    id: "blank-review",
    type: CanvasNodeType.Image,
    title: "12宫格分镜候选 1",
    position: { x: 400, y: 0 },
    width: 360,
    height: 630,
    metadata: { storyboardRole: "review-sheet", storyboardPlanId: "plan-1", prompt: "" },
};
const legacyPlanConnection: CanvasConnection = { id: "plan-review", fromNodeId: legacyPlanNode.id, toNodeId: blankLegacyReviewNode.id };
assert.equal(resolveStoryboardVideoPlan(blankLegacyReviewNode.id, [legacyPlanNode, blankLegacyReviewNode], [legacyPlanConnection]), apparelPlan, "blank legacy review sheets must recover their structured plan from the graph");
assert.deepEqual(resolveStoryboardVideoPlan("missing", [], [], `\`\`\`json\n${JSON.stringify(apparelPlan)}\n\`\`\``), apparelPlan, "serialized CommerceVideoPlan text must remain a recovery source");
const legacyAudioDirection = compileStoryboardAudioDirection(legacyApparelPlan, apparelPlan.directorBrief, 15);
assert.match(legacyAudioDirection, /generate clear commercial speech/i, "saved 3.0 plans without audioPlan must regain speech");
assert.match(legacyAudioDirection, /Mixed delivery:/i);
assert.match(legacyAudioDirection, /continue the same voice as off-screen narration over B-roll/i);
assert.match(legacyAudioDirection, /one evidence-safe 26-34-word English script/i);
assert.match(legacyAudioDirection, /finish one connected thought/i);
assert.match(legacyAudioDirection, /Start with a conversational 4-7 word reaction/i);
assert.doesNotMatch(legacyAudioDirection, /MANDATORY ON-CAMERA SPEECH SCHEDULE|cue timing|Narration timing lock/i);
assert.doesNotMatch(legacyAudioDirection, /0\.8-3\.8s|4\.2-7\.5s|11\.7-14\.7s/i);
const tenSecondLegacyAudioDirection = compileStoryboardAudioDirection(legacyApparelPlan, apparelPlan.directorBrief, 10);
assert.match(tenSecondLegacyAudioDirection, /18-24-word English script/i);
assert.doesNotMatch(tenSecondLegacyAudioDirection, /\d+(?:\.\d+)?-\d+(?:\.\d+)?s/i);
assert.equal(resolveStoryboardMode({ productCategory: "apparel" }), "apparel", "legacy apparel plans without storyboardMode must not receive product-cleaning constraints");

const silentAudioDirection = compileStoryboardAudioDirection({ ...apparelPlan, audioPlan: { mode: "ambient-only" } }, "music only", 15);
assert.match(silentAudioDirection, /Generate no speech/i);
assert.doesNotMatch(silentAudioDirection, /do not return a silent/i);

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
assert.equal(GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, "commerce-v13-clean-source-natural-voice");
assert.equal(channel28ConstraintPrompt.split(STORYBOARD_DIRECTED_VIDEO_MARKER).length - 1, 1, "constraint template must be emitted once");
assert.match(channel28ConstraintPrompt, /<IMAGE_1> is the exact product\/source identity lock/);
assert.match(channel28ConstraintPrompt, /<IMAGE_2> through <IMAGE_7> are ordered timeline anchors/);
assert.doesNotMatch(channel28ConstraintPrompt, /<IMAGE_8>/);
assert.match(channel28ConstraintPrompt, /Product lock:/);
assert.match(channel28ConstraintPrompt, /Shot lock:/);
assert.match(channel28ConstraintPrompt, /Human lock:/);
assert.match(channel28ConstraintPrompt, /polished 16:9/);
assert.doesNotMatch(channel28ConstraintPrompt, /polished 9:16/);

const wholeGridConstraintPrompt = buildStoryboardVideoConstraintPrompt({
    userDirection: "Follow the beach cleaning sequence and keep the same green bottle.",
    duration: 15,
    sourcePanelCount: 12,
    attachedReferenceCount: 1,
    identityReferenceCount: 0,
    aspectRatio: "9:16",
    audioDirection: legacyAudioDirection,
    wholeStoryboardGrid: true,
});
assert.match(wholeGridConstraintPrompt, /<IMAGE_1> is the complete ordered 12-panel storyboard and multi-pose identity sheet/);
assert.match(wholeGridConstraintPrompt, /derive normal identity and geometry from their consensus/i);
assert.match(wholeGridConstraintPrompt, /Timeline: 0-18%/);
assert.match(wholeGridConstraintPrompt, /Commerce rhythm:/);
assert.match(wholeGridConstraintPrompt, /Mixed delivery:/i);
assert.match(wholeGridConstraintPrompt, /Never crossfade, dissolve, overlap, ghost, clone, trail, or morph/i);
assert.match(wholeGridConstraintPrompt, /exactly one fully formed presenter per frame/i);

const anchoredWholeGridConstraintPrompt = buildStoryboardVideoConstraintPrompt({
    userDirection: "Follow the compiled beach apparel beats in order.",
    duration: 15,
    sourcePanelCount: 12,
    attachedReferenceCount: 1,
    identityReferenceCount: 1,
    aspectRatio: "9:16",
    audioDirection: legacyAudioDirection,
    wholeStoryboardGrid: true,
});
assert.match(anchoredWholeGridConstraintPrompt, /<IMAGE_1> is the clean high-resolution opening-frame identity anchor/i);
assert.match(anchoredWholeGridConstraintPrompt, /literal first shot without reframing or reconstructing hidden anatomy/i);
assert.match(anchoredWholeGridConstraintPrompt, /opening anchor's same eyes, jawline, face, skull, hair, neck, shoulders, torso, waist, limbs, wardrobe, age, proportions, and voice/i);
assert.doesNotMatch(anchoredWholeGridConstraintPrompt, /attached storyboard grid|from the grid/i);

const compiledWholeGridConstraintPrompt = buildStoryboardVideoConstraintPrompt({
    userDirection: "Follow the compiled beach apparel beats in order.",
    duration: 15,
    sourcePanelCount: 12,
    attachedReferenceCount: 0,
    identityReferenceCount: 0,
    aspectRatio: "9:16",
    audioDirection: legacyAudioDirection,
    wholeStoryboardGrid: true,
});
assert.match(compiledWholeGridConstraintPrompt, /storyboard has already been compiled into the ordered user direction/i);
assert.match(compiledWholeGridConstraintPrompt, /Create exactly 15 seconds/i);
assert.doesNotMatch(compiledWholeGridConstraintPrompt, /<IMAGE_1>/, "compiled whole-grid T2V must not invent a phantom image reference");
assert.doesNotMatch(compiledWholeGridConstraintPrompt, /Treat the attached storyboard grid|from the grid/i, "compiled whole-grid T2V must not describe an attachment that was not sent");
assert.match(compiledWholeGridConstraintPrompt, /compiled ordered storyboard direction/i);

const promptLimitProbe = buildStoryboardVideoConstraintPrompt({
    userDirection: "Follow the exact visible beach-cleaning actions in order with specific product handling, proof, reaction, and final hero framing. ".repeat(8).slice(0, 900),
    duration: 15,
    sourcePanelCount: 12,
    attachedReferenceCount: 1,
    identityReferenceCount: 0,
    aspectRatio: "9:16",
    audioDirection: wholeAudioDirection,
    wholeStoryboardGrid: true,
});
assert.ok(promptLimitProbe.length <= 3600, `whole-grid commerce prompt must fit the provider limit, received ${promptLimitProbe.length} characters`);

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
assert.equal(grokVideoReferenceMode("grok-imagine-video-1.5-fast", 1), "i2v");
assert.equal(grokVideoReferenceMode("grok-imagine-video-1.5-preview", 1), "r2v");
assert.equal(grokVideoReferenceMode("grok-imagine-video-1.5-1080p", 1), "i2v");
assert.deepEqual(
    selectGrokReferenceVideoImagesWithPriority<string>(
        [],
        Array.from({ length: 12 }, (_, index) => `frame-${index + 1}`),
        "grok-imagine-video-1.5-fast",
    ),
    ["frame-1", "frame-3", "frame-5", "frame-7", "frame-8", "frame-10", "frame-12"],
    "Fast storyboard sampling must preserve the full ordered arc and start from panel 1",
);
assert.deepEqual(
    selectGrokReferenceVideoImagesWithPriority(
        ["identity"],
        Array.from({ length: 12 }, (_, index) => `frame-${index + 1}`),
        "grok-imagine-video-1.5-fast",
    ),
    ["identity", "frame-1", "frame-3", "frame-5", "frame-8", "frame-10", "frame-12"],
    "Fast must preserve the upstream identity/product reference and sample six ordered timeline anchors",
);
assert.deepEqual(
    selectGrokReferenceVideoImagesWithPriority(
        Array.from({ length: 8 }, (_, index) => `direct-${index + 1}`),
        [],
        "grok-imagine-video-1.5-fast",
    ),
    Array.from({ length: 8 }, (_, index) => `direct-${index + 1}`),
    "direct user references must reach request validation instead of being silently truncated",
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
const videoPromptCompilerSource = readFileSync(new URL("../src/app/(user)/canvas/utils/video-prompt-compiler.ts", import.meta.url), "utf8");
const canvasImageDataSource = readFileSync(new URL("../src/app/(user)/canvas/utils/canvas-image-data.ts", import.meta.url), "utf8");
assert.match(canvasClientSource, /storyboardReviewSheetWholeReferences\(nodeId, nodesRef\.current, connectionsRef\.current\)/, "storyboard video generation must detect the selected whole grid before compiling its I2V prompt");
assert.match(canvasClientSource, /storyboardReviewSheetVideoAnchorReferences\(storyboardReviewSheetImages, generationConfig\.model\)/, "single-image Grok I2V must use a deterministic review-sheet anchor");
assert.match(canvasClientSource, /STORYBOARD_VIDEO_OPENING_PANEL_INDEX = 4/, "the clean I2V anchor must use the tested face-visible, full-body movement panel");
assert.match(canvasClientSource, /composeDataUrlGrid\(\[openingPanel\], \{ rows: 1, columns: 1, width: 720, height: 1280 \}\)/, "the Fast anchor must be a full-frame center crop without stretching or repainting");
assert.match(canvasClientSource, /wholeStoryboardAnchorMode = usesWholeStoryboardSheet \? storyboardVideoAnchorMode\(generationConfig\.model\)/, "whole-video metadata must record whether the direct sheet or deterministic clean panel anchor was used");
assert.doesNotMatch(canvasClientSource, /storyboardReviewSheetOpeningPanelReferences|createStoryboardVideoBridgeReference|generated-bridge|bridge-pending/, "whole-video generation must never regenerate or repaint the presenter identity");
assert.doesNotMatch(canvasClientSource, /VIDEO_BRIDGE_FALLBACK_IMAGE_MODELS|requestVideoBridgeImageAttempt\(fallbackConfig|首帧服务繁忙，正在切换备用模型/, "image bridge generation must never silently switch identity models");
assert.match(canvasClientSource, /const storyboardVideoImages = usesWholeStoryboardSheet \? wholeStoryboardImages : storyboardReferenceFrames/, "whole-video generation must use the model-specific opening anchor while the plan carries the full story");
assert.match(canvasClientSource, /referenceMode: grokVideoReferenceMode\(videoGenerationConfig\.model, videoReferenceImages\.length\)/, "whole-grid prompt compilation must describe each model's actual I2V or R2V contract");
assert.match(canvasClientSource, /hasReusableStoredStoryboardSheet/, "whole-video retry must trust only explicit review-sheet metadata");
assert.match(canvasClientSource, /mergeReferenceImages\(rebuiltWholeStoryboardAnchors, hasReusableStoredStoryboardSheet \? storedVideoReferenceImages : \[\]\)\.slice\(0, 1\)/, "whole-video retry must rebuild or restore the same model-specific review-sheet anchor");
assert.match(canvasClientSource, /retriesWholeStoryboardSheet \? retryWholeStoryboardAnchors : selectGrokReferenceVideoImagesWithPriority/, "whole-grid retry must keep exactly one model-specific review-sheet anchor");
assert.match(canvasClientSource, /buildWholeStoryboardI2VPrompt/, "whole-grid I2V must use the compact task-245-style prompt path");
assert.match(canvasClientSource, /referenceMode === "i2v"\) return buildWholeStoryboardLegacyI2VDirection/, "single-image Grok video must restore the proven task-245 request wrapper");
assert.match(canvasClientSource, /Show a clean full-frame face-visible presenter from frame one/, "single-image Grok video must begin speech on the clean panel anchor");
assert.match(canvasClientSource, /Say exactly once:/, "the compact task-245 direction must keep the exact duration-matched script ahead of truncation");
assert.match(canvasClientSource, /stagedStory\.matchAll/, "the compact task-245 direction must preserve all timed stages within the transport budget");
assert.match(canvasClientSource, /<IMAGE_1> is a visual reference sheet for identity, wardrobe, setting, and shot choices/, "whole-grid I2V must treat the review sheet as evidence rather than a frame-by-frame animation path");
assert.match(canvasClientSource, /Visible people, garments, products, props, actions, and environments in <IMAGE_1> override stale category wording/, "the visible grid must outrank stale legacy category wording");
assert.match(canvasClientSource, /one coherent short video/, "whole-grid video must request one continuous narrative rather than independent speech windows");
assert.match(canvasClientSource, /recoverLegacyStoryboardVideoPlan/, "legacy whole-grid videos must recover lost semantic direction before submission");
assert.match(canvasClientSource, /正在按当前时长恢复分镜语义与自然口播/, "the canvas must disclose duration-specific semantic recovery");
assert.match(canvasClientSource, /hasCompleteStoryboardAudioPlan\(storyboardPlan, Number\(videoGenerationConfig\.videoSeconds\)\)/, "a whole-grid request must require a script that fits the actual model duration");
assert.match(canvasClientSource, /defaultConfig\.textModel \|\| "tokaxis::gpt-5\.6-sol"/, "legacy storyboard recovery must always use the built-in GPT-5.6 Sol optimizer");
assert.match(canvasClientSource, /audioPlan\.scriptsByDuration with independent 6, 10, and 15 second scripts/, "semantic recovery must prepare independent scripts instead of truncating one master script");
assert.match(canvasClientSource, /Use at most.*stable full-frame story stages/, "whole-grid execution must enforce a duration-aware stage budget");
assert.match(canvasClientSource, /never rapidly cycle through similar panels or turn adjacent poses into separate shots/, "whole-grid execution must not replay same-location micro poses");
assert.match(canvasClientSource, /Move through the related locations\[\\s\\S\]\*\$\/i/, "the compact whole-grid direction must remove location and identity text already enforced by the wrapper");
assert.match(canvasClientSource, /never start on a headless crop, back view, or transition/, "presenter-led grids must begin on a complete stable face when one is available");
assert.match(canvasClientSource, /fullPrompt\.length <= 3500/, "whole-grid prompts must use the proven service capacity without reaching the 3600-character transport cap");
assert.match(videoPromptCompilerSource, /Say this exact script once, conversationally/, "storyboard speech must be one coherent performance");
assert.match(videoPromptCompilerSource, /storyboardAudioScriptForDuration/, "storyboard speech must select the script matching the normalized model duration");
assert.match(videoPromptCompilerSource, /Mixed delivery: open on one stable face-visible/, "storyboard speech must restore the proven short presenter line followed by voiceover rhythm");
assert.match(videoPromptCompilerSource, /Hold each stage continuously/, "Grok whole-video direction must preserve stable stage duration");
assert.match(videoPromptCompilerSource, /\[0:00-0:03\].*\[0:03-0:08\].*\[0:08-0:13\]/s, "15-second Grok direction must restore the proven four-stage cadence");
assert.match(canvasImageDataSource, /const targetAspect = cellWidth \/ cellHeight/, "3x3 anchor composition must center-crop panels without stretching people");
assert.match(videoPromptCompilerSource, /never infer language from visible labels/, "visible Chinese labels must not silently switch an English storyboard to Mandarin");
assert.doesNotMatch(videoPromptCompilerSource, /MANDATORY ON-CAMERA SPEECH SCHEDULE|On-camera cue timing|Narration timing lock/, "storyboard speech must never restore fixed timing windows");
assert.doesNotMatch(canvasClientSource, /wholeStoryboardGrid: true/, "whole-video I2V must not route through the obsolete grid template");
assert.match(canvasClientSource, /preserve this location order:/, "whole-grid prompt must preserve structured location order when it agrees with the visible grid");
assert.match(canvasClientSource, /do not collapse all visible locations into the opening background/, "whole-grid prompt must keep visible planned locations distinct");
assert.match(canvasClientSource, /compileStoryboardAudioDirection\(plan, text, duration\)/, "whole-grid I2V must inject the duration-aware audio lock before submission");
assert.match(canvasClientSource, /compileVideoBeatPrompt\(plan, beat, videoPromptContext\)/, "Phase 6 must compile a distinct prompt for each beat");
assert.match(canvasClientSource, /nodeOwnsVideoTiming = node\?\.type === CanvasNodeType\.Video \|\| node\?\.type === CanvasNodeType\.Config/, "image and storyboard nodes must use the active video duration instead of stale image metadata");
assert.match(hoverToolbarSource, /label: "生成整片"/, "review sheets must expose the full-video workflow");
assert.match(hoverToolbarSource, /label: "生成分段"/, "plan nodes must distinguish clip generation from full-video generation");
assert.match(configStoreSource, /textModel: "tokaxis::gpt-5\.6-sol"/, "built-in text optimization model must default to GPT-5.6 Sol");
assert.match(configStoreSource, /shouldMigrateTokaxisDefaults \? defaultConfig\.textModel/, "existing persisted defaults must migrate to GPT-5.6 Sol");
assert.match(configStoreSource, /shouldMigrateTextModel \? \["gpt-5\.6-sol"\]/, "legacy channel model lists must receive GPT-5.6 Sol during migration");
assert.doesNotMatch(promptPanelSource, /tokaxis::gpt-5\.5/, "prompt polish UI must not retain a GPT-5.5 fallback");
assert.match(videoServiceSource, /referenceMode === "i2v" \? \{ image: referenceImages\[0\] \}/, "Fast single-image mode must send the explicit image field");
assert.match(videoServiceSource, /referenceMode === "r2v" \? \{ reference_images: referenceImages \}/, "reference-to-video mode must preserve reference_images");
assert.match(videoServiceSource, /Visible speech rule: when a visible presenter is speaking, keep the face clearly visible for the complete line/i, "single-image I2V must preserve the task-245 visible-speech contract");
assert.doesNotMatch(videoServiceSource, /Use off-screen voiceover by default/, "single-image I2V must not regress to detached narration");
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
