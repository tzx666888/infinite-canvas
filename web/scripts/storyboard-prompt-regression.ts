import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CanvasNodeType, type CanvasCommerceVideoPlan, type CanvasConnection, type CanvasNodeData } from "../src/app/(user)/canvas/types";
import {
    compileStoryboardAudioDirection,
    compileStoryboardCleanAnchorVideoPrompt,
    compileVideoBeatPrompt,
    compileVideoPrompt,
    hasCompleteStoryboardAudioPlan,
    hasWornGarmentTreatmentConflict,
    repairStoryboardAudioPlanForDuration,
    resolveStoryboardMode,
    resolveStoryboardVideoPlan,
    selectBeatsForDuration,
    selectStoryboardLocationsForDuration,
    storyboardAudioScriptForDuration,
    storyboardShotBudget,
} from "../src/app/(user)/canvas/utils/video-prompt-compiler";
import { buildStoryboardVideoConstraintPrompt, GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, STORYBOARD_DIRECTED_VIDEO_MARKER, unwrapStoryboardVideoUserDirection } from "../src/lib/storyboard-video-constraints";
import { grokVideoReferenceMode, selectGrokReferenceVideoImagesWithPriority, supportsGrokVideoReferenceCount, videoAspectRatioForSize } from "../src/lib/video-model-settings";
import { buildCompactVideoProductScalePrompt } from "../src/lib/video-product-scale";
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
        script: "That wave surprised me. This bikini feels secure and comfortable, with ties that stay in place from shoreline to poolside while I move through every resort stop.",
        scriptsByDuration: {
            "6": "That wave surprised me. This bikini stays comfortable wherever I go.",
            "10": "That wave surprised me. This bikini feels secure and comfortable from shore to pool while I move through the whole resort.",
            "15": "That wave surprised me. This bikini feels secure and comfortable, with ties that stay in place from shoreline to poolside while I move through every resort stop.",
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
assert.equal(firstClipPrompt.split(STORYBOARD_DIRECTED_VIDEO_MARKER).length - 1, 1, "Phase 6 beat prompts must bypass the generic video wrapper exactly once");

const wholeAudioDirection = compileStoryboardAudioDirection(apparelPlan, apparelPlan.directorBrief, 15);
assert.match(wholeAudioDirection, /never return silent or music-only video/i);
assert.match(wholeAudioDirection, /natural English/i);
assert.match(wholeAudioDirection, /adult female voice/i);
assert.match(wholeAudioDirection, /Mixed delivery:/i);
assert.match(wholeAudioDirection, /says only the short first sentence/i);
assert.match(wholeAudioDirection, /After one breath/i);
assert.match(wholeAudioDirection, /Say this exact script once, conversationally/i);
assert.match(wholeAudioDirection, /That wave surprised me/i);
assert.doesNotMatch(wholeAudioDirection, /from shore to pool/i, "15-second generation must use the 15-second script variant");
assert.doesNotMatch(wholeAudioDirection, /cue timing|speech schedule|\d+(?:\.\d+)?-\d+(?:\.\d+)?s/i);

const cleanAnchorPrompt = compileStoryboardCleanAnchorVideoPrompt(apparelPlan, {
    model: "grok",
    duration: 15,
    aspectRatio: "9:16",
    referenceMode: "i2v",
});
assert.equal(cleanAnchorPrompt.split(STORYBOARD_DIRECTED_VIDEO_MARKER).length - 1, 1, "clean-anchor prompts must bypass the generic video wrapper exactly once");
assert.match(cleanAnchorPrompt, /clean keyframe as the exact identity anchor/i);
assert.match(cleanAnchorPrompt, /That wave surprised me/i, "the duration-matched script must survive compact prompt compilation");
assert.match(cleanAnchorPrompt, /Say exactly once, naturally and verbatim/i);
assert.match(cleanAnchorPrompt, /micro-pauses under 0\.35s/i, "creator speech must avoid the model's long mid-sentence gaps");
assert.match(cleanAnchorPrompt, /speak through 14\.4-14\.8s/i, "creator speech must fill the clip instead of ending with a long silent tail");
assert.match(cleanAnchorPrompt, /Lip-sync the first six words only/i);
assert.match(cleanAnchorPrompt, /immediately continue the same sentence off-screen/i);
assert.doesNotMatch(cleanAnchorPrompt, /hard cut to/i);
assert.match(cleanAnchorPrompt, /reacts naturally to a small wave/i);
assert.match(cleanAnchorPrompt, /delivers the final line/i);
assert.match(cleanAnchorPrompt, /one continuous medium shot/i);
assert.match(cleanAnchorPrompt, /No cuts, reframing, zooms/i);
assert.doesNotMatch(cleanAnchorPrompt, /at most 4 stable shots|Hard cuts only/i);
assert.ok(cleanAnchorPrompt.split(/\s+/).length <= 180, `clean-anchor Grok prompt must remain compact, received ${cleanAnchorPrompt.split(/\s+/).length} words`);
const cleanAnchorProviderPrompt = `${cleanAnchorPrompt} ${buildCompactVideoProductScalePrompt("handheld")}`.trim();
assert.ok(cleanAnchorProviderPrompt.split(/\s+/).length <= 190, `clean-anchor prompt plus explicit scale lock must stay concise, received ${cleanAnchorProviderPrompt.split(/\s+/).length} words`);
assert.doesNotMatch(cleanAnchorPrompt, /complete storyboard contact sheet|decode its panels|animate the grid/i);

const recoveredVerbosePlan: CanvasCommerceVideoPlan = {
    ...apparelPlan,
    audioPlan: {
        ...apparelPlan.audioPlan,
        voice: "Natural adult female creator voice with a brief surprised opening, followed by calm continuous off-screen narration",
    },
    beats: apparelPlan.beats?.slice(0, 4).map((item, index) => ({
        ...item,
        description: `Following the ${index === 0 ? "first two visible" : index === 3 ? "final two visible" : "next two"} panels, an overlong panel-order explanation that should never replace the actual visible action.`,
        eightElements: {
            ...item.eightElements,
            action: [
                "A wave splashes as the woman reacts and reveals the green bottle",
                "She checks the wet side tie and sprays the removed black bikini",
                "Her hands clean and rinse the black bikini",
                "She gives one thumbs-up and finishes on the shoreline product packshot",
            ][index],
        },
    })),
};
const recoveredCompactPrompt = compileStoryboardCleanAnchorVideoPrompt(recoveredVerbosePlan, { model: "grok", duration: 15, aspectRatio: "9:16", referenceMode: "i2v" });
assert.match(recoveredCompactPrompt, /one continuous stable creator take/i, "single-anchor presenter videos must not rebuild the person across editorial cuts");
assert.doesNotMatch(recoveredCompactPrompt, /hard cut to/i);
assert.doesNotMatch(recoveredCompactPrompt, /sprays the removed/i, "an impossible middle state must not be forced into a single-anchor creator take");
assert.match(recoveredCompactPrompt, /thumbs-up/i, "the stable shots must retain the CTA action");
assert.match(recoveredCompactPrompt, /warm, lively, conversational, unscripted/i, "creator delivery must not be flattened into calm narration");
assert.doesNotMatch(recoveredCompactPrompt, /voice with a brief\s*;/i, "voice compaction must not leave a dangling adjective before the language separator");
assert.doesNotMatch(recoveredCompactPrompt, /with one\s*;/i, "voice compaction must not leave a truncated consistency phrase");
assert.doesNotMatch(recoveredCompactPrompt, /Following the .* panels|\b(?:a|an|the|and|or|to|of|with)\s*; hard cut/i, "compiled stages must not end in panel-order boilerplate or dangling connector words");
assert.match(recoveredCompactPrompt, /use only physically plausible local handling/i);
assert.ok(recoveredCompactPrompt.split(/\s+/).length <= 180, `recovered clean-anchor prompt must remain compact, received ${recoveredCompactPrompt.split(/\s+/).length} words`);

const voiceoverProductPlan: CanvasCommerceVideoPlan = {
    ...recoveredVerbosePlan,
    storyboardMode: "product",
    productCategory: "fabric cleaner",
    visualIdentity: "The same green cleaner bottle and black garment remain unchanged.",
    audioPlan: { ...recoveredVerbosePlan.audioPlan, mode: "voiceover" },
};
const voiceoverProductPrompt = compileStoryboardCleanAnchorVideoPrompt(voiceoverProductPlan, { model: "grok", duration: 15, aspectRatio: "9:16", referenceMode: "i2v" });
assert.match(voiceoverProductPrompt, /hard cut to/i, "product voiceover videos must retain their planned multi-shot action sequence");
assert.match(voiceoverProductPrompt, /sprays the removed black bikini/i, "stage compaction must retain the complete action object");
assert.match(voiceoverProductPrompt, /at most 4 stable shots/i);
assert.doesNotMatch(voiceoverProductPrompt, /continuous creator take/i);
assert.equal(hasWornGarmentTreatmentConflict(voiceoverProductPlan), true, "a cleaner plan must detect when its target garment starts on the presenter");

const mixedCleanerPlan: CanvasCommerceVideoPlan = {
    ...voiceoverProductPlan,
    audioPlan: { ...voiceoverProductPlan.audioPlan, mode: "mixed" },
};
const mixedCleanerPrompt = compileStoryboardCleanAnchorVideoPrompt(mixedCleanerPlan, { model: "grok", duration: 15, aspectRatio: "9:16", referenceMode: "i2v" });
assert.match(mixedCleanerPrompt, /one separate unworn black bikini on a waist-high table/i);
assert.match(mixedCleanerPrompt, /so this cleaner stays in my beach bag/i, "conflicting saved narration must be replaced by a physically coherent creator line");
assert.match(mixedCleanerPrompt, /a few quick sprays make cleanup easy/i);
assert.doesNotMatch(mixedCleanerPrompt, /I'm cleaning the black bikini right here|spraying the removed|hard cut to/i);
assert.match(mixedCleanerPrompt, /one connected flow with micro-pauses under 0\.35s, no repeats or restarts, speak through 14\.4-14\.8s/i);
assert.match(mixedCleanerPrompt, /Lip-sync the first six words only/i);
assert.match(mixedCleanerPrompt, /No cuts.*duplicates/i);
const mixedCleanerProviderPrompt = `${mixedCleanerPrompt} ${buildCompactVideoProductScalePrompt("handheld")}`.trim();
assert.ok(mixedCleanerProviderPrompt.split(/\s+/).length <= 180, `conflict-safe creator prompt plus scale lock must stay within 180 words, received ${mixedCleanerProviderPrompt.split(/\s+/).length}`);

const legacyApparelPlan: CanvasCommerceVideoPlan = {
    ...apparelPlan,
    audioPlan: undefined,
    beats: apparelPlan.beats?.map(({ spokenLine: _spokenLine, ...item }) => item),
};
assert.equal(hasCompleteStoryboardAudioPlan(apparelPlan), true, "a saved exact whole-video script is complete");
assert.equal(hasCompleteStoryboardAudioPlan(apparelPlan, 10), true, "a saved duration-specific script is complete for its matching model duration");
assert.equal(hasCompleteStoryboardAudioPlan(legacyApparelPlan), false, "legacy plans without a script must be enriched before a billable whole-video request");
assert.equal(hasCompleteStoryboardAudioPlan({ ...apparelPlan, audioPlan: { ...apparelPlan.audioPlan, scriptsByDuration: undefined } }, 10), false, "a 15-second base script must not be reused by a 10-second model");
const repairedLegacySpeechPlan = repairStoryboardAudioPlanForDuration(
    {
        ...apparelPlan,
        audioPlan: {
            ...apparelPlan.audioPlan,
            script: "That wave came out of nowhere. I'm cleaning the black bikini right here at the shoreline, then rinsing it before showing the fabric, ties, and finished beach look.",
            scriptsByDuration: undefined,
        },
    },
    15,
);
assert.equal(hasCompleteStoryboardAudioPlan(repairedLegacySpeechPlan, 15), true, "saved long speech must be repaired locally instead of blocking video submission");
assert.equal(repairedLegacySpeechPlan.audioPlan?.script, "That wave came out of nowhere. I'm cleaning the black bikini right here at the shoreline, then rinsing it before showing the fabric, ties, and finished beach look.");
assert.equal(repairedLegacySpeechPlan.audioPlan?.scriptsByDuration?.["15"], undefined, "a complete duration-safe base script does not need a duplicate active slot");
assert.equal(
    storyboardAudioScriptForDuration(repairedLegacySpeechPlan, 15),
    "That wave came out of nowhere. I'm cleaning the black bikini right here at the shoreline, then rinsing it before showing the fabric, ties, and finished beach look.",
    "provider speech must preserve natural contractions and conversational phrasing without changing the saved plan",
);
assert.match(compileStoryboardCleanAnchorVideoPrompt(repairedLegacySpeechPlan, { model: "grok", duration: 15, aspectRatio: "9:16", referenceMode: "i2v" }), /then rinsing it before showing the fabric/i);

const stalledCreatorPlan: CanvasCommerceVideoPlan = {
    ...recoveredVerbosePlan,
    audioPlan: {
        ...recoveredVerbosePlan.audioPlan,
        script: "That wave came out of nowhere. I'm cleaning the black bikini right here at the shoreline, then rinsing it.",
        scriptsByDuration: {
            ...recoveredVerbosePlan.audioPlan?.scriptsByDuration,
            "15": "That wave came out of nowhere. I'm cleaning the black bikini right here at the shoreline, then rinsing it.",
        },
    },
    beats: recoveredVerbosePlan.beats?.map((item, index) => ({
        ...item,
        spokenLine: ["That wave came out of nowhere.", "I'm cleaning the black bikini right here at the shoreline,", "then rinsing it", "before showing the fabric, ties,"][index],
    })),
};
assert.equal(hasCompleteStoryboardAudioPlan(stalledCreatorPlan, 15), false, "the short v3.0.21 script must be upgraded before another 15-second billable request");
const repairedStalledCreatorPlan = repairStoryboardAudioPlanForDuration(stalledCreatorPlan, 15);
assert.equal(hasCompleteStoryboardAudioPlan(repairedStalledCreatorPlan, 15), true, "saved beat fragments must restore full-duration creator speech locally");
assert.match(repairedStalledCreatorPlan.audioPlan?.script || "", /before showing the fabric, ties/i);
const repairedStalledCreatorPrompt = compileStoryboardCleanAnchorVideoPrompt(repairedStalledCreatorPlan, { model: "grok", duration: 15, aspectRatio: "9:16", referenceMode: "i2v" });
assert.match(repairedStalledCreatorPrompt, /I'm cleaning the black bikini right here/i, "creator speech must preserve natural contractions and conversational filler");
assert.doesNotMatch(repairedStalledCreatorPrompt, /sprays the removed|hard cut to/i);
assert.match(repairedStalledCreatorPrompt, /Say exactly once, naturally and verbatim/i);
assert.match(repairedStalledCreatorPrompt, /Lip-sync the first six words only/i);
assert.match(repairedStalledCreatorPrompt, /speak through 14\.4-14\.8s/i);
assert.ok(repairedStalledCreatorPrompt.split(/\s+/).length <= 180, `upgraded creator prompt must remain compact, received ${repairedStalledCreatorPrompt.split(/\s+/).length} words`);
const repairedStalledProviderPrompt = `${repairedStalledCreatorPrompt} ${buildCompactVideoProductScalePrompt("handheld")}`.trim();
assert.ok(repairedStalledProviderPrompt.split(/\s+/).length <= 190, `upgraded creator prompt plus scale lock must remain compact, received ${repairedStalledProviderPrompt.split(/\s+/).length} words`);

assert.match(storyboardAudioScriptForDuration(apparelPlan, 10), /from shore to pool/i);
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
assert.equal(GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION, "commerce-v14-clean-anchor-natural-voice");
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
const promptPolishSource = readFileSync(new URL("../src/services/api/prompt-polish.ts", import.meta.url), "utf8");
assert.match(promptPanelSource, /mode !== "video" && storyboardPlan\?\.beats\?\.length/, "a completed video node must resubmit its video request instead of regenerating storyboard review sheets");
assert.match(canvasClientSource, /storyboardReviewSheetWholeReferences\(nodeId, nodesRef\.current, connectionsRef\.current\)/, "storyboard video generation must detect the selected whole grid before compiling its I2V prompt");
assert.match(canvasClientSource, /storyboardReviewSheetKeyframeAnchorReferences\(nodeId, nodesRef\.current, connectionsRef\.current\)/, "whole-video generation must prefer the selected review sheet's independent keyframe");
assert.match(
    canvasClientSource,
    /const needsStoryboardBridge = usesWholeStoryboardSheet && !hasReusableStoredStoryboardAnchor && \(!storyboardKeyframeAnchorImages\.length \|\| storyboardIdentityImages\.length > 0\)/,
    "whole-video generation must rebuild a clean anchor when identity or product sources need to be preserved",
);
assert.match(canvasClientSource, /createStoryboardVideoBridgeReference/, "whole-video generation must build a clean full-frame anchor before I2V");
assert.match(canvasClientSource, /identityReferences: storyboardIdentityImages/, "the bridge must retain original product and identity references");
assert.match(canvasClientSource, /storyboardReference: storyboardReviewSheetImages\[0\]/, "the complete storyboard must remain planning evidence for the clean bridge");
assert.match(canvasClientSource, /storyboardVideoAnchorMode: "generated-bridge"/, "successful bridge generation must persist the actual clean anchor for retry");
assert.match(canvasClientSource, /hasReusableStoredStoryboardAnchor/, "successful whole-video regeneration must reuse its persisted clean anchor instead of billing another bridge image");
assert.match(canvasClientSource, /storedStoryboardAnchorImages\.slice\(0, 1\)/, "normal regeneration must submit the stored clean anchor as the only I2V reference");
assert.match(canvasClientSource, /const videoReferenceVideos = usesWholeStoryboardSheet \? \[\] : generationContext\.referenceVideos/, "whole-storyboard regeneration must not inherit an upstream generated video as a Grok reference");
assert.match(canvasClientSource, /const videoReferenceAudios = usesWholeStoryboardSheet \? \[\] : generationContext\.referenceAudios/, "whole-storyboard regeneration must not inherit unrelated upstream audio");
assert.match(canvasClientSource, /storyboardReviewSheetImages\.length > 0 \|\| isStoredWholeStoryboardVideo\(sourceNode\)/, "a refreshed successful video must retain whole-storyboard behavior from its own saved plan and anchor metadata");
assert.doesNotMatch(canvasClientSource, /STORYBOARD_VIDEO_OPENING_PANEL_INDEX|storyboardReviewSheetVideoAnchorReferences|composeDataUrlGrid\(\[openingPanel\]/, "whole-video generation must never crop a hard-coded contact-sheet panel into an I2V frame");
assert.match(canvasClientSource, /VIDEO_BRIDGE_FALLBACK_IMAGE_MODELS/, "clean-anchor generation must have a declared fallback model order");
assert.match(canvasClientSource, /requestVideoBridgeImageAttempt\(fallbackConfig/, "clean-anchor generation must retry transient primary-model failures with an available fallback");
assert.match(canvasClientSource, /首帧服务繁忙，正在切换备用模型/, "the UI must disclose clean-anchor fallback instead of silently changing models");
assert.match(canvasClientSource, /const storyboardVideoImages = usesWholeStoryboardSheet \? wholeStoryboardImages : storyboardReferenceFrames/, "whole-video generation must use the model-specific opening anchor while the plan carries the full story");
assert.match(canvasClientSource, /referenceMode: grokVideoReferenceMode\(videoGenerationConfig\.model, videoReferenceImages\.length\)/, "whole-grid prompt compilation must describe each model's actual I2V or R2V contract");
assert.match(canvasClientSource, /hasReusableStoredStoryboardAnchor/, "whole-video retry must trust only an independent keyframe or generated bridge");
assert.match(canvasClientSource, /storyboardVideoAnchorMode === "generated-bridge" \|\| node\.metadata\?\.storyboardVideoAnchorMode === "keyframe"/, "retry must reject obsolete raw-sheet and panel anchors");
assert.match(canvasClientSource, /needsRetryStoryboardBridge/, "whole-video retry must rebuild unsafe legacy anchors before resubmission");
assert.match(canvasClientSource, /const retryReferenceVideos = retriesWholeStoryboardSheet \? \[\]/, "whole-storyboard retry must discard graph-derived video references");
assert.match(canvasClientSource, /storyboardRetryWholeImages\.length > 0 \|\| isStoredWholeStoryboardVideo\(node\)/, "retry must recognize a persisted whole-storyboard video without requiring a directly connected review sheet");
assert.match(canvasClientSource, /retriesWholeStoryboardSheet \? retryWholeStoryboardAnchors : selectGrokReferenceVideoImagesWithPriority/, "whole-grid retry must keep exactly one model-specific review-sheet anchor");
assert.match(canvasClientSource, /compileStoryboardCleanAnchorVideoPrompt\(storyboardPlan/, "whole-grid I2V must use the compact clean-anchor compiler");
assert.doesNotMatch(canvasClientSource, /buildWholeStoryboardI2VPrompt|buildWholeStoryboardLegacyI2VDirection/, "the markerless legacy whole-grid wrapper must stay removed");
assert.match(canvasClientSource, /recoverLegacyStoryboardVideoPlan/, "legacy whole-grid videos must recover lost semantic direction before submission");
assert.match(canvasClientSource, /正在按当前时长恢复分镜语义与自然口播/, "the canvas must disclose duration-specific semantic recovery");
assert.match(canvasClientSource, /hasCompleteStoryboardAudioPlan\(storyboardPlan, Number\(videoGenerationConfig\.videoSeconds\)\)/, "a whole-grid request must require a script that fits the actual model duration");
assert.match(canvasClientSource, /defaultConfig\.textModel \|\| "tokaxis::gpt-5\.6-sol"/, "legacy storyboard recovery must always use the built-in GPT-5.6 Sol optimizer");
assert.match(canvasClientSource, /audioPlan\.scriptsByDuration with independent 6, 10, and 15 second scripts/, "semantic recovery must prepare independent scripts instead of truncating one master script");
assert.match(canvasClientSource, /10-14, 18-24, and 26-34 English words/, "legacy recovery must use the same proven speech budgets as the compiler");
assert.match(promptPolishSource, /10-14、18-24、26-34 词/, "new storyboard plans must use the proven duration-specific speech budgets");
assert.match(promptPolishSource, /简单、易发音的日常词和短从句/, "new storyboard speech must favor simple pronounceable language");
assert.match(promptPolishSource, /保留口语缩写/, "new storyboard speech must preserve conversational phrasing");
assert.match(canvasClientSource, /preserve conversational contractions/, "legacy storyboard recovery must not turn creator speech into formal dictation");
assert.match(canvasClientSource, /repairStoryboardAudioPlanForDuration\(storyboardPlan/, "saved long storyboard speech must be repaired locally before an optimizer request");
assert.match(canvasClientSource, /repairStoryboardAudioPlanForDuration\(enrichedSource, duration\)/, "optimizer output must receive deterministic duration repair before validation");
assert.match(videoPromptCompilerSource, /compileStoryboardCleanAnchorVideoPrompt/, "clean-anchor prompt compilation must remain independently regression-testable");
assert.match(videoPromptCompilerSource, /from the clean keyframe as the exact identity anchor/, "Grok must receive the bridge as a clean literal opening frame, never as a contact sheet");
assert.match(videoPromptCompilerSource, /One continuous medium shot/, "single-anchor presenter execution must keep one identity-safe camera setup");
assert.match(videoPromptCompilerSource, /hasWornGarmentTreatmentConflict/, "whole-video execution must detect impossible worn-garment cleaning states");
assert.match(videoPromptCompilerSource, /at most \$\{storyboardShotBudget\(duration\)\} stable shots/, "voiceover and product-only execution must retain a duration-aware stable-shot budget");
assert.match(videoPromptCompilerSource, /Say this exact script once, conversationally/, "storyboard speech must be one coherent performance");
assert.match(videoPromptCompilerSource, /storyboardAudioScriptForDuration/, "storyboard speech must select the script matching the normalized model duration");
assert.match(videoPromptCompilerSource, /Mixed delivery: open on one stable face-visible/, "storyboard speech must restore the proven short presenter line followed by voiceover rhythm");
assert.match(videoPromptCompilerSource, /Hold each stage continuously/, "Grok whole-video direction must preserve stable stage duration");
assert.match(videoPromptCompilerSource, /\[0:00-0:03\].*\[0:03-0:08\].*\[0:08-0:13\]/s, "15-second Grok direction must restore the proven four-stage cadence");
assert.match(videoPromptCompilerSource, /never infer language from visible labels/, "visible Chinese labels must not silently switch an English storyboard to Mandarin");
assert.doesNotMatch(videoPromptCompilerSource, /MANDATORY ON-CAMERA SPEECH SCHEDULE|On-camera cue timing|Narration timing lock/, "storyboard speech must not restore the old per-sentence timing matrix");
assert.match(videoPromptCompilerSource, /one connected flow with micro-pauses under 0\.35s, no repeats or restarts, speak through 14\.4-14\.8s/, "15-second creator speech must stay fluid and fill the video");
assert.match(canvasClientSource, /the target garment exists exactly once and is never worn/, "the clean bridge must resolve worn-garment treatment conflicts before video generation");
assert.doesNotMatch(canvasClientSource, /wholeStoryboardGrid: true/, "whole-video I2V must not route through the obsolete grid template");
assert.match(canvasClientSource, /compileVideoBeatPrompt\(plan, beat, videoPromptContext\)/, "Phase 6 must compile a distinct prompt for each beat");
assert.match(canvasClientSource, /nodeOwnsVideoTiming = node\?\.type === CanvasNodeType\.Video \|\| node\?\.type === CanvasNodeType\.Config/, "image and storyboard nodes must use the active video duration instead of stale image metadata");
assert.match(hoverToolbarSource, /label: "生成整片"/, "review sheets must expose the full-video workflow");
assert.match(hoverToolbarSource, /label: "生成分段"/, "plan nodes must distinguish clip generation from full-video generation");
assert.match(configStoreSource, /textModel: "tokaxis::gpt-5\.6-sol"/, "built-in text optimization model must default to GPT-5.6 Sol");
assert.match(configStoreSource, /shouldMigrateTokaxisDefaults \? defaultConfig\.textModel/, "existing persisted defaults must migrate to GPT-5.6 Sol");
assert.match(configStoreSource, /shouldMigrateTextModel \? \["gpt-5\.6-sol", \.\.\.Object\.values\(TOKAXIS_GOOGLE_IMAGE_MODELS\)\]/, "legacy channel model lists must receive GPT-5.6 Sol during migration");
assert.doesNotMatch(promptPanelSource, /tokaxis::gpt-5\.5/, "prompt polish UI must not retain a GPT-5.5 fallback");
assert.match(videoServiceSource, /referenceMode === "i2v" \? \{ image: referenceImages\[0\] \}/, "Fast single-image mode must send the explicit image field");
assert.match(videoServiceSource, /referenceMode === "r2v" \? \{ reference_images: referenceImages \}/, "reference-to-video mode must preserve reference_images");
assert.match(videoServiceSource, /if \(isCompiledVideoPrompt\(rawPrompt\)\)/, "compiled storyboard, workbench, and product-lock prompts must bypass the generic wrapper");
assert.match(videoServiceSource, /prompt\.includes\("PRODUCT-LOCKED KEYFRAME VIDEO\."\)/, "product bridge prompts must not be wrapped a second time");
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
