import type { CanvasCommerceVideoPlan, CanvasConnection, CanvasNodeData } from "../types";
import { STORYBOARD_DIRECTED_VIDEO_MARKER } from "@/lib/storyboard-video-constraints";

export type VideoTargetModel = "grok" | "veo";

export type VideoPromptContext = {
    model: VideoTargetModel;
    duration: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
    referenceMode: "t2v" | "i2v" | "r2v";
};

type CommerceVideoBeat = NonNullable<CanvasCommerceVideoPlan["beats"]>[number];

const DEFAULT_ENHANCEMENT_WORDS = "4K ultra HD, cinematic quality, natural body proportions, smooth natural motion within each shot, clean hard cuts, consistent appearance throughout";
const visiblePresenterPattern = /\b(?:adult|woman|women|female|lady|mother|mom|wife|man|men|male|father|dad|husband|presenter|host|model|actor|actress|person)\b|成年人|女性|女人|妈妈|妻子|女主播|男性|男人|爸爸|丈夫|男主播|主播|模特|演员/i;

export function compileVideoPrompt(plan: CanvasCommerceVideoPlan, context: VideoPromptContext): string {
    const beats = selectBeatsForDuration(plan.beats, context.duration) || [];
    return context.model === "veo" ? compileVeoPrompt(plan, beats, context) : compileGrokPrompt(plan, beats, context);
}

export function compileVideoBeatPrompt(plan: CanvasCommerceVideoPlan, beat: CommerceVideoBeat, context: VideoPromptContext): string {
    const mode = resolveStoryboardMode(plan);
    const orderedBeats = orderBeats(plan.beats);
    const beatPosition = orderedBeats.findIndex((candidate) => candidate.index === beat.index);
    const previousBeat = beatPosition > 0 ? orderedBeats[beatPosition - 1] : undefined;
    const nextBeat = beatPosition >= 0 ? orderedBeats[beatPosition + 1] : undefined;
    const shotType = readableText(beat.shotType, "medium shot");
    const cameraMove = readableText(beat.cameraMove, "controlled camera movement");
    const prompt = [
        STORYBOARD_DIRECTED_VIDEO_MARKER,
        `Create one ${context.duration}-second ${aspectText(context.aspectRatio)} clip for this storyboard beat only.`,
        `${shotType}, ${cameraMove}: ${describeBeat(beat, plan)}.`,
        "Animate only the action in this beat. Do not replay the opening, demonstration, ending, or any other beat from the full storyboard.",
        previousBeat ? "Begin with identity, wardrobe, product, lighting, and motion continuity from the preceding beat without repeating its action." : "Make the opening action immediately readable from the attached keyframe.",
        nextBeat ? "End on a stable action or camera position that can cut cleanly into the next beat; do not perform the next beat yet." : "Finish this beat on one clean resolving pose or product position.",
        compileStoryboardBeatAudioDirection(plan, beat, context.duration),
        identityConstraint(plan, mode),
        locationConstraint(plan, mode, true),
        referenceConstraint(context.referenceMode, plan, mode),
        "Output clean full-frame footage with stable anatomy and rigid-object geometry: no grid, labels, captions, morphing, duplicated subjects, or unrelated entities.",
    ]
        .filter(Boolean)
        .join(" ");
    return normalizeSpaces(limitWords(prompt, 180));
}

export function compileStoryboardCleanAnchorVideoPrompt(plan: CanvasCommerceVideoPlan, context: VideoPromptContext): string {
    const duration = Math.max(1, Math.floor(context.duration || 15));
    const mode = resolveStoryboardMode(plan);
    const beats = selectBeatsForDuration(plan.beats, duration) || [];
    const stageRanges = grokStageRanges(beats.length || 1, duration);
    const audioPlan = plan.audioPlan;
    const presenterEvidence = [plan.visualIdentity || "", plan.directorBrief || "", ...beats.flatMap((beat) => [beat.description || "", beat.eightElements?.subject || ""])].join(" ");
    const hasCreatorPresenter = mode === "apparel" || mode === "subject" || audioPlan?.mode === "mixed" || audioPlan?.mode === "on-camera" || visiblePresenterPattern.test(presenterEvidence);
    const useStableCreatorTake = hasCreatorPresenter && audioPlan?.mode !== "ambient-only" && audioPlan?.mode !== "voiceover";
    const wornGarmentTreatmentConflict = hasWornGarmentTreatmentConflict(plan);
    const stages = useStableCreatorTake
        ? stableCreatorStory(plan, beats, duration, wornGarmentTreatmentConflict)
        : beats.length
          ? beats.map((beat, index) => `${stageRanges[index]} ${compactStoryboardStageAction(beat, plan, 12)}`).join("; hard cut to ")
          : `${stageRanges[0]} ${limitBeatWords(fallbackActionChain(plan, mode, readableText(plan.productCategory, "the referenced subject")), 12)}`;
    const script = creatorAudioScriptForDuration(plan, duration, wornGarmentTreatmentConflict);
    const audioDirection =
        audioPlan?.mode === "ambient-only"
            ? "Audio: natural location sound and restrained music only; no speech."
            : useStableCreatorTake
              ? [
                    `Audio: ${compactStoryboardCreatorVoice(audioPlan?.voice)}; ${audioPlan?.language || "English"}.`,
                    script ? `Speak this once, naturally: "${script}"` : "Deliver one connected creator-style thought once.",
                    creatorSpeechTiming(duration),
                    "Keep one readable face with natural expression and synchronized lips throughout speech.",
                ].join(" ")
              : [
                    `Audio: ${compactStoryboardVoice(audioPlan?.voice)}; ${audioPlan?.language || "English"}.`,
                    script ? `Say exactly once: "${script}"` : "Deliver one short connected creator-style line once.",
                    audioPlan?.mode === "on-camera"
                        ? "Keep the same face readable and lip-synchronized for the entire line."
                        : audioPlan?.mode === "voiceover"
                          ? "Keep the voice off-screen while visible people act naturally."
                          : "Lip-sync the short opening sentence, then use the same voice off-screen over details.",
                ].join(" ");
    const identityDirection =
        mode === "product"
            ? "Lock the presenter and exact product shape, colors, label layout, count, and scale."
            : mode === "apparel"
              ? "Lock the adult face, hair, body proportions, garment design, fit, material, and coverage."
              : "Lock the same subject identity, wardrobe, body proportions, and visual world.";
    const prompt = [
        STORYBOARD_DIRECTED_VIDEO_MARKER,
        `Create ${duration}s ${context.aspectRatio} footage.`,
        "Use the clean keyframe as exact opening and identity anchor.",
        `Story: ${stages}.`,
        audioDirection,
        identityDirection,
        useStableCreatorTake
            ? "Use one continuous medium shot with gentle drift. No cuts, scene changes, full-body reframing, zooms, giant hands, teleports, product/garment duplicates, morphs, or anatomy changes."
            : `Use at most ${storyboardShotBudget(duration)} stable shots. Hard cuts only; no dissolves, crossfades, ghosts, morphs, duplicates, anatomy errors, grids, captions, or invented claims.`,
    ].join(" ");
    return normalizeSpaces(prompt);
}

export function hasWornGarmentTreatmentConflict(plan: CanvasCommerceVideoPlan) {
    if (resolveStoryboardMode(plan) !== "product") return false;
    const orderedBeats = orderBeats(plan.beats);
    const openingEvidence = [plan.visualIdentity || "", plan.directorBrief || "", orderedBeats[0]?.description || "", orderedBeats[0]?.eightElements?.action || ""].join(" ");
    const fullEvidence = [plan.productCategory || "", plan.visualIdentity || "", plan.directorBrief || "", plan.audioPlan?.script || "", ...orderedBeats.flatMap((beat) => [beat.description || "", beat.eightElements?.action || ""])].join(" ");
    const wearerStartsInTarget = /\b(?:wearing|wears|worn|dressed in|fitted in)\b[^.]{0,80}\b(?:bikini|swimsuit|swimwear|garment|dress|shirt|top|pants|jacket|coat)\b/i.test(openingEvidence);
    const presenterAndRemovedTarget = visiblePresenterPattern.test(openingEvidence) && /\bremoved\b[^.]{0,60}\b(?:bikini|swimsuit|swimwear|garment|dress|shirt|top|pants|jacket|coat)\b/i.test(fullEvidence);
    const cleaningProduct = /\b(?:cleaner|detergent|cleaning spray|stain remover|fabric wash|laundry)\b/i.test(fullEvidence);
    const treatsGarment = /\b(?:spray|clean|brush|scrub|rinse|wash|wipe|treat|remove)\w*\b[^.]{0,100}\b(?:bikini|swimsuit|swimwear|garment|fabric|dress|shirt|top|pants|jacket|coat)\b/i.test(fullEvidence);
    return (wearerStartsInTarget || presenterAndRemovedTarget) && cleaningProduct && treatsGarment;
}

export function compileStoryboardAudioDirection(plan: CanvasCommerceVideoPlan | undefined, sourcePrompt = "", duration = 15): string {
    const audioPlan = plan?.audioPlan;
    const userDirection = [sourcePrompt, plan?.directorBrief || ""].join(" ");
    if (audioPlan?.mode === "ambient-only" || requestsAmbientOnly(userDirection)) {
        return "Audio lock: use only natural location sound, restrained sound effects, and low background music. Generate no speech, dialogue, narration, singing, captions, or subtitles.";
    }

    const evidence = [userDirection, plan?.visualIdentity || "", ...(plan?.beats || []).map((beat) => beat.description || "")].join(" ");
    const hasVisiblePresenter = plan?.storyboardMode === "apparel" || plan?.storyboardMode === "subject" || visiblePresenterPattern.test(evidence);
    const mode = audioPlan?.mode || (hasVisiblePresenter ? "mixed" : "voiceover");
    const voice = compactSpeechText(audioPlan?.voice || "", 180) || inferredVoiceDirection(evidence);
    const beatScript = orderBeats(plan?.beats)
        .map((beat) => compactSpeechText(beat.spokenLine || "", 140))
        .filter(Boolean)
        .join(" ");
    const script = compactSpeechText(storyboardAudioScriptForDuration(plan, duration) || beatScript, 520);
    const languageDirection = storyboardLanguageDirection(audioPlan?.language, userDirection);
    const voiceDirection = `${voice.replace(/[.!?]+$/g, "")}.`;
    const performance =
        mode === "on-camera"
            ? "On-camera delivery: keep the same presenter's full face and mouth readable whenever words are spoken, with synchronized lips, jaw, breath, and expression. Pause speech during face-hidden, back-view, product-only, or detail shots."
            : mode === "mixed"
              ? "Mixed delivery: open on one stable face-visible medium or close shot where the same presenter says only the short first sentence with synchronized lips and natural facial motion. After one breath, continue the same voice as off-screen narration over B-roll; never speak over a frozen, hidden, back-view, or mismatched mouth."
              : "Voiceover delivery: keep speech off-screen; visible presenters act naturally and never fake the narration.";
    const scriptDirection = script
        ? `Say this exact script once, conversationally, with one natural breath and no restart: "${script}"`
        : `Compose and say one evidence-safe ${speechWordBudget(duration)}-word English script or equivalent cadence. Start with a conversational 4-7 word reaction, take one breath, and finish one connected thought. No shot-order language, feature checklist, repeated slogan, or disconnected fragment.`;

    return [
        "Audio lock: generate clear commercial speech; never return silent or music-only video.",
        voiceDirection,
        languageDirection,
        performance,
        scriptDirection,
        "Keep music below the voice. No captions, invented prices, certifications, brand wording, testimonials, medical claims, or unsupported benefits.",
    ].join(" ");
}

function compileStoryboardBeatAudioDirection(plan: CanvasCommerceVideoPlan, beat: CommerceVideoBeat, duration: number) {
    const audioPlan = plan.audioPlan;
    const userDirection = plan.directorBrief || "";
    if (audioPlan?.mode === "ambient-only" || requestsAmbientOnly(userDirection)) {
        return "Use only natural location sound and low background music; generate no speech or narration for this beat.";
    }

    const evidence = [plan.visualIdentity || "", beat.description || ""].join(" ");
    const languageDirection = storyboardLanguageDirection(audioPlan?.language, userDirection);
    const voice = compactSpeechText(audioPlan?.voice || "", 180) || inferredVoiceDirection(evidence);
    const spokenLine = compactSpeechText(beat.spokenLine || "", 220);
    const fullScript = compactSpeechText(storyboardAudioScriptForDuration(plan, duration), 420);
    if (audioPlan?.mode === "on-camera" && !spokenLine) {
        return "This is a silent B-roll beat. Generate no speech, dialogue, narration, or singing; use only natural location sound and low background music. Do not animate the presenter as if speaking.";
    }
    const speech = spokenLine
        ? `Say exactly this line once: "${spokenLine}"`
        : fullScript
          ? `Perform only one short phrase from this full narration that directly matches this beat, without repeating the whole script: "${fullScript}"`
          : `Create and perform one evidence-safe line of at most ${Math.max(6, Math.min(14, Math.round(duration * 1.8)))} words describing only this beat's visible action.`;
    const delivery =
        spokenLine && audioPlan?.mode !== "voiceover" && visiblePresenterPattern.test(evidence)
            ? "The visible adult presenter speaks with natural synchronized lips and facial motion."
            : "Use off-screen voiceover and do not make a visible presenter fake the narration.";
    return `Generate clear audible speech for this clip. ${languageDirection} ${voice} ${speech} ${delivery} Keep music below the voice; no captions, unsupported claims, or spoken production instructions.`;
}

export function selectBeatsForDuration(beats: CanvasCommerceVideoPlan["beats"], duration: number): CanvasCommerceVideoPlan["beats"] {
    const orderedBeats = orderBeats(beats);
    if (!orderedBeats.length) return [];
    if (duration <= 4) return pickBeatsByPhase(orderedBeats, ["hook", "cta"], 2);
    if (duration <= 6) return orderBeats(pickBeatsByPhase(orderedBeats, ["hook", "cta"], 2));
    if (duration <= 10) return orderBeats(pickBeatsByPhase(orderedBeats, ["hook", "demo", "cta"], 3));
    if (duration <= 12) return orderBeats(pickBeatsByPhase(orderedBeats, ["hook", "pain", "demo", "cta"], 4));
    if (orderedBeats.length <= 4) return orderedBeats;

    const hook = findBeatByPhase(orderedBeats, "hook") || orderedBeats[0];
    const cta = findLastBeatByPhase(orderedBeats, "cta") || orderedBeats[orderedBeats.length - 1];
    const middle = orderedBeats.filter((beat) => beat !== hook && beat !== cta);
    return orderBeats([hook, ...pickEvenly(middle, 2), cta]);
}

export function extractCommerceVideoPlan(rawText: string): CanvasCommerceVideoPlan | null {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    const direct = parsePlan(trimmed);
    if (direct) return direct;

    const fencedMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
    for (const match of fencedMatches) {
        const parsed = parsePlan(match[1]?.trim() || "");
        if (parsed) return parsed;
    }

    for (const candidate of extractJsonObjects(trimmed)) {
        const parsed = parsePlan(candidate);
        if (parsed) return parsed;
    }

    return null;
}

export function storyboardAudioScriptForDuration(plan: CanvasCommerceVideoPlan | null | undefined, duration: number) {
    const audioPlan = plan?.audioPlan;
    if (!audioPlan || audioPlan.mode === "ambient-only") return "";
    const durationKey = storyboardScriptDurationKey(duration);
    const durationScript = audioPlan.scriptsByDuration?.[durationKey]?.trim();
    if (durationScript && storyboardScriptFitsDuration(durationScript, audioPlan.language, duration)) {
        return normalizeStoryboardSpeechForProvider(durationScript, audioPlan.language);
    }
    const baseScript = audioPlan.script?.trim() || "";
    return baseScript && storyboardScriptFitsDuration(baseScript, audioPlan.language, duration) ? normalizeStoryboardSpeechForProvider(baseScript, audioPlan.language) : "";
}

export function hasCompleteStoryboardAudioPlan(plan: CanvasCommerceVideoPlan | null | undefined, duration?: number) {
    if (!plan?.beats?.length) return false;
    if (plan.audioPlan?.mode === "ambient-only") return true;
    if (duration !== undefined) {
        const durationKey = storyboardScriptDurationKey(duration);
        const durationScript = plan.audioPlan?.scriptsByDuration?.[durationKey]?.trim();
        if (durationScript && storyboardScriptFitsDuration(durationScript, plan.audioPlan?.language, duration)) return true;
        const baseScript = plan.audioPlan?.script?.trim();
        return Boolean(baseScript && storyboardScriptFitsDuration(baseScript, plan.audioPlan?.language, duration));
    }
    if (plan.audioPlan?.script?.trim()) return true;
    if (Object.values(plan.audioPlan?.scriptsByDuration || {}).some((script) => Boolean(script?.trim()))) return true;
    return plan.beats.some((beat) => Boolean(beat.spokenLine?.trim()));
}

export function repairStoryboardAudioPlanForDuration(plan: CanvasCommerceVideoPlan, duration: number): CanvasCommerceVideoPlan {
    if (!plan.beats?.length || plan.audioPlan?.mode === "ambient-only" || hasCompleteStoryboardAudioPlan(plan, duration)) return plan;

    const durationKey = storyboardScriptDurationKey(duration);
    const audioPlan = plan.audioPlan || {};
    const candidates = [
        audioPlan.scriptsByDuration?.[durationKey],
        audioPlan.script,
        orderBeats(plan.beats)
            .map((beat) => beat.spokenLine?.trim())
            .filter(Boolean)
            .join(" "),
    ].filter((value): value is string => Boolean(value?.trim()));
    const candidate = candidates.find((value) => storyboardScriptFitsDuration(value, audioPlan.language, duration)) || candidates.sort((left, right) => speechWordCount(right) - speechWordCount(left))[0];
    if (!candidate) return plan;

    const repairedScript = repairEnglishStoryboardScript(candidate, duration);
    if (!repairedScript || !storyboardScriptFitsDuration(repairedScript, audioPlan.language || "English", duration)) return plan;

    const evidence = [plan.visualIdentity || "", ...plan.beats.map((beat) => beat.description || "")].join(" ");
    return {
        ...plan,
        audioPlan: {
            ...audioPlan,
            mode: audioPlan.mode || (visiblePresenterPattern.test(evidence) ? "mixed" : "voiceover"),
            language: audioPlan.language || "English",
            voice: audioPlan.voice || inferredVoiceDirection(evidence),
            script: repairedScript,
            scriptsByDuration: {
                ...audioPlan.scriptsByDuration,
                [durationKey]: repairedScript,
            },
        },
    };
}

export function selectStoryboardLocationsForDuration(plan: CanvasCommerceVideoPlan, duration: number) {
    const selectedBeats = selectBeatsForDuration(plan.beats, duration) || [];
    const beatLocations = uniqueReadableLocations(selectedBeats.map((beat) => beat.eightElements?.scene || ""));
    const plannedLocations = uniqueReadableLocations(plan.plannedLocations || []);
    const candidates = beatLocations.length ? beatLocations : plannedLocations;
    const maximum = storyboardShotBudget(duration);
    return candidates.length <= maximum ? candidates : pickEvenly(candidates, maximum);
}

export function storyboardShotBudget(duration: number) {
    if (duration <= 6) return 2;
    if (duration <= 10) return 3;
    return 4;
}

export function resolveStoryboardVideoPlan(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], rawText = "") {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sourceNode = nodeById.get(nodeId);
    const directPlan = commercePlanFromNode(sourceNode);
    if (directPlan) return directPlan;

    const planId = sourceNode?.metadata?.storyboardPlanId;
    if (planId) {
        for (const node of nodes) {
            if (node.metadata?.storyboardPlanId !== planId) continue;
            const sharedPlan = commercePlanFromNode(node);
            if (sharedPlan) return sharedPlan;
        }
    }

    const incoming = new Map<string, string[]>();
    for (const connection of connections) {
        const ids = incoming.get(connection.toNodeId) || [];
        ids.push(connection.fromNodeId);
        incoming.set(connection.toNodeId, ids);
    }
    const queue = [...(incoming.get(nodeId) || [])];
    const visited = new Set<string>([nodeId]);
    while (queue.length) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const currentNode = nodeById.get(currentId);
        const upstreamPlan = commercePlanFromNode(currentNode);
        if (upstreamPlan) return upstreamPlan;
        queue.push(...(incoming.get(currentId) || []));
    }

    return extractCommerceVideoPlan(rawText);
}

function commercePlanFromNode(node: CanvasNodeData | undefined) {
    const direct = node?.metadata?.commerceVideoPlan;
    if (direct?.beats?.length) return direct;
    for (const text of [node?.metadata?.content, node?.metadata?.prompt]) {
        const extracted = extractCommerceVideoPlan(text || "");
        if (extracted?.beats?.length) return extracted;
    }
    return null;
}

function compileGrokPrompt(plan: CanvasCommerceVideoPlan, beats: CommerceVideoBeat[], context: VideoPromptContext) {
    const mode = resolveStoryboardMode(plan);
    const category = readableText(plan.productCategory, mode === "product" ? "the referenced product" : "the referenced subject");
    const beatWordBudget = Math.max(14, Math.min(22, Math.floor(80 / Math.max(1, beats.length))));
    const beatText = beats
        .map((beat) => describeBeat(beat, plan))
        .map(sanitizeStoryboardBeatDirection)
        .filter(Boolean)
        .map((text) => limitBeatWords(text, beatWordBudget));
    const stageRanges = grokStageRanges(beatText.length, context.duration);
    const actionChain = beatText.length ? beatText.map((text, index) => `${index === 0 ? "" : "hard cut to "}${stageRanges[index]} ${text}`).join("; ") : fallbackActionChain(plan, mode, category);
    const plannedLocations = selectStoryboardLocationsForDuration(plan, context.duration);
    const locationDirection =
        resolveLocationStrategy(plan, mode) === "single-location"
            ? "Keep one coherent environment while the framing and action visibly progress."
            : `Move through the related locations${plannedLocations.length ? ` in this order: ${plannedLocations.join(" -> ")}` : ""}. Do not omit a planned location or collapse every shot back into the first background.`;
    const opening =
        mode === "apparel"
            ? `Create a ${context.duration}-second ${context.aspectRatio} short-form apparel video with the same referenced adult model and garment.`
            : mode === "subject"
              ? `Create a ${context.duration}-second ${context.aspectRatio} short video centered on the same referenced subject.`
              : mode === "scene"
                ? `Create a ${context.duration}-second ${context.aspectRatio} scene-progression video inside one coherent visual world.`
                : `Create a ${context.duration}-second ${context.aspectRatio} commerce video for the exact referenced ${category}.`;
    const prompt = [
        opening,
        `Follow one coherent staged visual story in this order: ${actionChain}. Hold each stage continuously; adjacent reference poses are alternatives, not extra cuts.`,
        locationDirection,
        identityConstraint(plan, mode),
        "Use clean direct editorial cuts, varied but readable framing, and natural local motion. Keep the same face, body, wardrobe, product geometry, and voice throughout; never morph between shots.",
        endingConstraint(mode),
    ]
        .filter(Boolean)
        .join(" ");
    return normalizeSpaces(limitWords(prompt, 200));
}

function storyboardScriptDurationKey(duration: number): "6" | "10" | "15" {
    if (duration <= 6) return "6";
    if (duration <= 10) return "10";
    return "15";
}

function storyboardScriptFitsDuration(script: string, language: string | undefined, duration: number) {
    const normalizedLanguage = (language || "").trim().toLowerCase();
    const looksEnglish = /english|\ben\b/.test(normalizedLanguage) || (!normalizedLanguage && !/[\u3400-\u9fff]/.test(script));
    if (!looksEnglish) return true;
    const wordCount = speechWordCount(script);
    const [minimum, maximum] = storyboardSpeechWordRange(duration);
    return wordCount >= minimum && wordCount <= maximum;
}

function speechWordCount(value: string) {
    return value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
}

function storyboardSpeechWordRange(duration: number): [number, number] {
    if (duration <= 6) return [10, 14];
    if (duration <= 10) return [18, 24];
    return [26, 34];
}

function repairEnglishStoryboardScript(value: string, duration: number) {
    const normalized = normalizeSpaces(value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'));
    if (!normalized) return "";

    const [minimum, maximum] = storyboardSpeechWordRange(duration);
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length >= minimum && words.length <= maximum) return ensureSentenceEnding(normalized);
    if (words.length < minimum) {
        const suffix = duration <= 6 ? "right now" : duration <= 10 ? "and see the final result" : "so you can see the finished result clearly";
        const extended = `${normalized.replace(/[,;:.!?\s]+$/g, "")} ${suffix}.`;
        const extendedWords = speechWordCount(extended);
        return extendedWords >= minimum && extendedWords <= maximum ? extended : fallbackStoryboardScript(duration);
    }

    let selected = words.slice(0, maximum);
    const connectorPattern = /^(?:and|or|but|before|after|while|because|with|without|to|for|from|as)$/i;
    const danglingPattern = /^(?:a|an|the|and|or|but|before|after|while|because|with|without|to|for|from|as|then|showing|revealing|presenting)$/i;
    const tokenText = (word: string) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");

    for (let index = selected.length - 1; index >= Math.max(minimum, selected.length - 5); index -= 1) {
        if (connectorPattern.test(tokenText(selected[index] || "")) && index >= minimum) {
            selected = selected.slice(0, index);
            break;
        }
    }
    while (selected.length > minimum && danglingPattern.test(tokenText(selected.at(-1) || ""))) selected.pop();
    if (selected.length < minimum) return fallbackStoryboardScript(duration);
    return ensureSentenceEnding(selected.join(" ").replace(/[,;:\s]+$/g, ""));
}

function ensureSentenceEnding(value: string) {
    const trimmed = value.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeStoryboardSpeechForProvider(value: string, language: string | undefined) {
    const normalizedLanguage = (language || "").trim().toLowerCase();
    const looksEnglish = /english|\ben\b/.test(normalizedLanguage) || (!normalizedLanguage && !/[\u3400-\u9fff]/.test(value));
    if (!looksEnglish) return value.trim();
    return ensureSentenceEnding(normalizeSpaces(value.replace(/[\u2018\u2019]/g, "'").replace(/\s+([,.;!?])/g, "$1")));
}

function fallbackStoryboardScript(duration: number) {
    if (duration <= 6) return "See this product in action from start to finish.";
    if (duration <= 10) return "Watch how I use this product step by step, showing each action clearly and ending with the final result.";
    return "Watch how I use this product step by step, keeping each action clear, the presentation lively, and the final result natural and easy to follow from start to finish.";
}

function uniqueReadableLocations(locations: string[]) {
    const seen = new Set<string>();
    return locations
        .map((location) => limitBeatWords(location.trim(), 10))
        .filter((location) => location && !/^the same referenced environment\.?$/i.test(location))
        .filter((location) => {
            const key = location.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function compileVeoPrompt(plan: CanvasCommerceVideoPlan, beats: CommerceVideoBeat[], context: VideoPromptContext) {
    const mode = resolveStoryboardMode(plan);
    const category = readableText(plan.productCategory, mode === "product" ? "the referenced product" : "the referenced subject");
    const ranges = timelineRanges(beats.length || 1, context.duration);
    const lines = beats.length
        ? beats.map((beat, index) => {
              const range = ranges[index] || ranges[ranges.length - 1];
              const shotType = readableText(beat.shotType, "medium shot");
              const cameraMove = readableText(beat.cameraMove, "smooth camera movement");
              return `${range} ${shotType}, ${cameraMove}: ${describeBeat(beat, plan)}.`;
          })
        : [`${ranges[0]} medium shot, smooth camera movement: ${fallbackActionChain(plan, mode, category)}.`];
    return normalizeSpaces(
        [
            videoOpening(mode, context, category),
            ...lines,
            identityConstraint(plan, mode),
            locationConstraint(plan, mode, false),
            endingConstraint(mode),
            referenceConstraint(context.referenceMode, plan, mode),
            plan.enhancementWords || DEFAULT_ENHANCEMENT_WORDS,
            "Negative prompt: no unrelated products, no invented bottles, no invented packaging, no category substitution, no imported props, no fabricated certifications, no fake discounts, no exaggerated medical or beauty claims, no visible storyboard labels, no arrows, no grid panels, no watermarks.",
        ]
            .filter(Boolean)
            .join("\n"),
    );
}

function describeBeat(beat: CommerceVideoBeat, plan: CanvasCommerceVideoPlan) {
    const description = readableText(beat.description, fallbackBeatDescription(beat, plan));
    const camera = readableText(beat.eightElements?.camera, "");
    const lighting = readableText(beat.eightElements?.lighting, "");
    const scene = readableText(beat.eightElements?.scene, "");
    return [description, scene && `in ${scene}`, lighting && `with ${lighting}`, camera && `using ${camera}`].filter(Boolean).join(", ");
}

function fallbackBeatDescription(beat: CommerceVideoBeat, plan: CanvasCommerceVideoPlan) {
    const mode = resolveStoryboardMode(plan);
    const category = readableText(plan.productCategory, mode === "product" ? "the referenced product" : "the referenced subject");
    const hook = readableText(plan.hookDescription, `a high-specificity visual hook for ${category}`);
    if (beat.phase === "hook") return hook;
    if (mode === "apparel") {
        if (beat.phase === "pain") return "advance the referenced adult model's natural movement while preserving the same face, body proportions, garment fit, coverage, and material";
        if (beat.phase === "demo") return "show the referenced garment's fit, construction, and movement on the same adult model without adding any separate product";
        if (beat.phase === "cta") return "finish with a clean identity-preserving apparel hero moment in the final planned related location";
    }
    if (mode === "subject" || mode === "scene") {
        if (beat.phase === "pain") return "advance the referenced action or visual tension without introducing new entities";
        if (beat.phase === "demo") return "continue the referenced subject or scene through a clear, physically plausible action beat";
        if (beat.phase === "cta") return "finish with a coherent resolving image using only the referenced subject and the final planned related environment";
    }
    if (beat.phase === "pain") return `show the real use context that makes ${category} relevant, without inventing a problem or claim`;
    if (beat.phase === "demo") return "show a clear product use or detail that is explicitly supported by the reference and plan";
    if (beat.phase === "cta") return "finish with the same referenced product in a clean resolving shot without inventing offers or claims";
    return "show a clear visual beat that advances the ordered reference-led story";
}

export function resolveStoryboardMode(plan: CanvasCommerceVideoPlan): NonNullable<CanvasCommerceVideoPlan["storyboardMode"]> {
    if (plan.storyboardMode === "product" || plan.storyboardMode === "apparel" || plan.storyboardMode === "subject" || plan.storyboardMode === "scene") {
        return plan.storyboardMode;
    }
    const category = (plan.productCategory || "").trim().toLowerCase();
    if (category === "apparel" || category.includes("clothing") || category.includes("fashion")) return "apparel";
    if (category === "person" || category === "portrait" || category === "character") return "subject";
    if (category === "scene" || category === "landscape" || category === "environment") return "scene";
    return "product";
}

function resolveLocationStrategy(plan: CanvasCommerceVideoPlan, mode = resolveStoryboardMode(plan)): NonNullable<CanvasCommerceVideoPlan["locationStrategy"]> {
    if (plan.locationStrategy === "single-location" || plan.locationStrategy === "related-location-montage") return plan.locationStrategy;
    return mode === "product" ? "single-location" : "related-location-montage";
}

function fallbackActionChain(plan: CanvasCommerceVideoPlan, mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>, category: string) {
    if (mode === "apparel")
        return `open on the referenced adult model and ${category}, progress through natural garment movement, fit details, and clean cuts across related lifestyle locations, then finish with the same model and garment in a strong closing frame`;
    if (mode === "subject") return "open on the referenced subject, progress through physically plausible actions and clean cuts across related planned locations, then finish with a coherent resolving frame";
    if (mode === "scene") return "establish the referenced visual world, progress through one visible event across its related zones, then finish on a coherent resolving view";
    return `open with a reference-supported hook for ${category}, show only its real visible use or details, then finish with the same referenced product`;
}

function videoOpening(mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>, context: VideoPromptContext, category: string) {
    const format = `${context.duration}-second ${aspectText(context.aspectRatio)}`;
    if (mode === "apparel") return `Create a ${format} short-form apparel video featuring the same referenced adult model and ${category}.`;
    if (mode === "subject") return `Create a ${format} reference-led short video centered on the same subject.`;
    if (mode === "scene") return `Create a ${format} reference-led short video preserving one coherent visual world while the environment progresses through its planned related zones.`;
    return `Create a ${format} commerce video for the exact referenced ${category}.`;
}

function videoRhythm(mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    if (mode === "apparel")
        return "Use an energetic lifestyle-montage rhythm: a strong face, silhouette, or motion hook; varied full-body, tracking, and material-detail shots; clean editorial cuts through the related locations in the ordered beats; then a confident apparel hero finish.";
    if (mode === "subject")
        return "Use an energetic cinematic-subject rhythm: strong first image, varied camera distance, clear physical progression, related-location cuts, and a memorable visual payoff. Do not force a commercial problem, rescue product, demonstration, or purchase cue.";
    if (mode === "scene") return "Use a high-retention scene-progression rhythm: strong establishing image, visible event and spatial progression, varied scale and camera direction, then a coherent environmental payoff.";
    return "Use a high-retention product rhythm by percentage: 0-20% reference-supported hook; 20-70% real use, construction, or visible detail from the ordered beats; 70-100% clear result or product finish. Do not invent mess, rescue, cleaning, or before/after actions.";
}

function identityConstraint(plan: CanvasCommerceVideoPlan, mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    const lock = readableText(plan.visualIdentity, "");
    const forbidden = (plan.forbiddenAdditions || [])
        .map((item) => readableText(item, ""))
        .filter(Boolean)
        .join(", ");
    const modeRule =
        mode === "apparel"
            ? "The worn garment is the product; never add a bottle, package, cleaner, tool, foam, wiping action, or unrelated prop."
            : mode === "subject" || mode === "scene"
              ? "No product is required; never invent packaging, brands, bottles, tools, or purchase gestures."
              : "Use only the exact referenced product and never replace it with another category.";
    return [lock ? `Identity lock: ${lock}.` : "Maintain exact visual identity across all shots.", modeRule, forbidden ? `Forbidden additions: ${forbidden}.` : ""].filter(Boolean).join(" ");
}

function locationConstraint(plan: CanvasCommerceVideoPlan, mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>, singleBeat: boolean) {
    const strategy = resolveLocationStrategy(plan, mode);
    const locations = (plan.plannedLocations || []).map((location) => location.trim()).filter(Boolean);
    if (strategy === "single-location") return "Keep one coherent environment while making camera position, framing, depth, and action visibly progress.";
    if (singleBeat) return `Use only the environment assigned to this beat; preserve the same visual world and do not jump ahead to another planned location.${locations.length ? ` The full sequence location order is ${locations.join(" -> ")}.` : ""}`;
    return `Allow clean hard cuts only among the related locations explicitly described by the ordered beats${locations.length ? `, in this mandatory order: ${locations.join(" -> ")}` : ""}. Keep one coherent visual world, but do not collapse every shot back into the first reference background or omit a planned location.`;
}

function endingConstraint(mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    if (mode === "product") return "Use realistic lighting and believable physical motion; end with the same referenced product without inventing claims, labels, offers, or unrelated objects.";
    return "Use realistic lighting and believable physical motion; end on the final ordered beat in its planned related location without adding a product, package, purchase cue, or unplanned scene.";
}

function aspectText(aspectRatio: VideoPromptContext["aspectRatio"]) {
    if (aspectRatio === "9:16") return "vertical 9:16 composition with the subject centered or slightly above center";
    if (aspectRatio === "16:9") return "horizontal 16:9 composition with enough environmental space around the subject";
    return "square 1:1 composition with compact centered framing";
}

function referenceConstraint(referenceMode: VideoPromptContext["referenceMode"], plan: CanvasCommerceVideoPlan, mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    const identity = readableText(plan.visualIdentity, "");
    if (referenceMode === "i2v") {
        const environmentRule =
            resolveLocationStrategy(plan, mode) === "single-location" ? "preserve the reference environment" : "use the reference for opening identity and composition, then follow only the related locations explicitly planned in the beats";
        return `Maintain visual continuity with the reference image: preserve subject appearance, wardrobe or product structure, color palette, and opening composition; ${environmentRule}.${identity ? ` Preserve this identity exactly: ${identity}.` : ""}`;
    }
    if (referenceMode === "r2v") return "Use the reference video as motion and rhythm guidance. Preserve the subject and key visual elements from the reference frames.";
    return "";
}

function pickBeatsByPhase(beats: CommerceVideoBeat[], phases: string[], targetCount: number) {
    const selected: CommerceVideoBeat[] = [];
    for (const phase of phases) {
        const beat = findBeatByPhase(beats, phase);
        if (beat && !selected.includes(beat)) selected.push(beat);
    }
    for (const beat of beats) {
        if (selected.length >= targetCount) break;
        if (!selected.includes(beat)) selected.push(beat);
    }
    return selected.slice(0, targetCount);
}

function findBeatByPhase(beats: CommerceVideoBeat[], phase: string) {
    return beats.find((beat) => beat.phase === phase);
}

function findLastBeatByPhase(beats: CommerceVideoBeat[], phase: string) {
    return [...beats].reverse().find((beat) => beat.phase === phase);
}

function orderBeats(beats: CanvasCommerceVideoPlan["beats"]) {
    return [...(beats || [])].sort((a, b) => a.index - b.index);
}

function pickEvenly<T>(items: T[], count: number) {
    if (items.length <= count) return items;
    if (count <= 0) return [];
    if (count === 1) return [items[Math.floor(items.length / 2)]];
    const lastIndex = items.length - 1;
    return Array.from({ length: count }, (_, index) => items[Math.round((index * lastIndex) / (count - 1))]);
}

function grokStageRanges(count: number, duration: number) {
    if (count === 2 && duration <= 6) return ["[0:00-0:03]", `[0:03-0:${String(duration).padStart(2, "0")}]`];
    if (count === 3 && duration <= 10) return ["[0:00-0:03]", "[0:03-0:07]", `[0:07-0:${String(duration).padStart(2, "0")}]`];
    if (count === 4 && duration >= 15) return ["[0:00-0:03]", "[0:03-0:08]", "[0:08-0:13]", `[0:13-0:${String(duration).padStart(2, "0")}]`];
    return timelineRanges(count, duration);
}

function timelineRanges(count: number, duration: number) {
    const safeCount = Math.max(1, count);
    return Array.from({ length: safeCount }, (_, index) => {
        const start = Math.round((index * duration) / safeCount);
        const end = index === safeCount - 1 ? duration : Math.round(((index + 1) * duration) / safeCount);
        return `[${formatTime(start)}-${formatTime(end)}]`;
    });
}

function formatTime(seconds: number) {
    return `0:${String(seconds).padStart(2, "0")}`;
}

function readableText(value: string | undefined, fallback: string) {
    const trimmed = normalizeSpaces(value || "");
    if (!trimmed) return fallback;
    return /[\u3400-\u9fff]/.test(trimmed) ? fallback : trimmed;
}

function requestsAmbientOnly(value: string) {
    return /\b(?:silent|no (?:speech|dialogue|dialog|voice|voiceover|narration)|without (?:speech|dialogue|voice|narration)|ambient(?: sound)? only|music only)\b|无声|不要说话|不需要说话|无口播|不要口播|纯音乐|只要环境音/i.test(value);
}

function inferredVoiceDirection(value: string) {
    const femaleLead = /\b(?:woman|women|female|lady|mother|mom|wife|actress)\b|女性|女人|妈妈|妻子|女演员|女主播/i.test(value);
    const maleLead = /\b(?:man|men|male|father|dad|husband|actor)\b|男性|男人|爸爸|丈夫|男演员|男主播/i.test(value);
    if (femaleLead) return "Use one natural, energetic adult female voice throughout; never switch to male narration.";
    if (maleLead) return "Use one natural adult male voice matching the visible adult male lead throughout.";
    return "Use one consistent natural adult commercial voice throughout, matching the visible adult lead when one exists.";
}

function storyboardLanguageDirection(explicitLanguage: string | undefined, userDirection: string) {
    const language = compactSpeechText(explicitLanguage || "", 80);
    if (language) return `Speak natural ${language} throughout and never change language or speaker.`;
    if (/[㐀-鿿]/.test(userDirection)) return "Speak natural Mandarin Chinese throughout and never change language or speaker.";
    return "Speak natural English with one speaker; never infer language from visible labels.";
}

function speechWordBudget(duration: number) {
    if (duration <= 6) return "10-14";
    if (duration <= 10) return "18-24";
    if (duration <= 15) return "26-34";
    return `${Math.max(18, Math.round(duration * 1.2))}-${Math.max(22, Math.round(duration * 1.5))}`;
}

function compactSpeechText(value: string, maxChars: number) {
    const compact = value
        .replace(/[\r\n]+/g, " ")
        .replace(/[\"\u201c\u201d]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, Math.max(1, maxChars - 3)).trim()}...`;
}

function sanitizeStoryboardBeatDirection(value: string) {
    return normalizeSpaces(
        value
            .replace(/^Following\b[^,]{0,160},\s*/i, "")
            .replace(/\bContinue in the visible panel order as\b/gi, "")
            .replace(/\bpreserve the final (?:\w+|\d+)-panel progression:\s*/gi, "finish with ")
            .replace(/\b(?:visible|numbered|ordered) panel order\b/gi, "planned story order"),
    );
}

function compactStoryboardVoice(value: string | undefined) {
    const voice = normalizeSpaces((value || "one natural presenter-matched voice").replace(/[.!?]+$/g, ""))
        .replace(/\s+with a brief surprised opening,?\s*followed by calm continuous off-screen narration\b/i, ", surprised opener then calm narration")
        .replace(/\bfollowed by\b/gi, "then")
        .replace(/\boff-screen narration\b/gi, "narration");
    return limitBeatWords(voice, 10);
}

function compactStoryboardCreatorVoice(value: string | undefined) {
    const voice = readableText(value, "Natural adult creator voice");
    const gender = /\bfemale\b/i.test(voice) ? "female " : /\bmale\b/i.test(voice) ? "male " : "";
    return `Natural adult ${gender}creator voice: warm, lively, conversational, unscripted`;
}

function stableCreatorStory(plan: CanvasCommerceVideoPlan, beats: CommerceVideoBeat[], duration: number, wornGarmentTreatmentConflict: boolean) {
    const finalStart = duration <= 6 ? 5 : duration <= 10 ? 8 : Math.max(2, duration - 3);
    const target = wornGarmentTarget(plan);
    if (wornGarmentTreatmentConflict) {
        return [
            `one continuous demo: [0:00-0:02] react and face the camera with the cleaner`,
            `[0:02-${formatTime(finalStart)}] speak while using it only on one separate unworn ${target} on a waist-high surface`,
            `[${formatTime(finalStart)}-${formatTime(duration)}] hold the cleaner and ${target} at natural scale`,
        ].join("; then ");
    }

    const opening = beats[0] ? compactStoryboardStageAction(beats[0], plan, 12) : "begin from the exact opening pose and address the camera naturally";
    const endingBeat = beats.at(-1);
    const ending = endingBeat && endingBeat !== beats[0] ? compactStoryboardStageAction(endingBeat, plan, 12) : "finish with one stable product or subject presentation";
    return `one continuous stable creator take: ${opening}; use only physically plausible local handling possible from the opening frame; then ${ending}`;
}

function creatorAudioScriptForDuration(plan: CanvasCommerceVideoPlan, duration: number, wornGarmentTreatmentConflict: boolean) {
    const script = storyboardAudioScriptForDuration(plan, duration);
    if (!wornGarmentTreatmentConflict || !looksEnglishStoryboardSpeech(script, plan.audioPlan?.language)) return script;
    const target = wornGarmentTarget(plan);
    if (duration <= 6) return "That wave was wild. Good thing this cleaner stays in my beach bag.";
    if (duration <= 10) return `That wave was wild. I keep this cleaner in my beach bag, then use it on my ${target} after swimming.`;
    return `That wave came out of nowhere. I keep this cleaner in my beach bag, then use it on my ${target} after swimming before a fresh-water rinse.`;
}

function creatorSpeechTiming(duration: number) {
    if (duration <= 6) return "Start near 0.4s, take one natural breath, and finish at 5.2-5.7s; no rushing or long silent tail.";
    if (duration <= 10) return "Start near 0.5s, take two short breaths, and finish at 9.0-9.6s; no rushing or long silent tail.";
    return "Start near 0.5s, take two natural breaths, and finish at 13.2-14.2s; no rushing, chanting, or long silent tail.";
}

function wornGarmentTarget(plan: CanvasCommerceVideoPlan) {
    const evidence = [plan.productCategory || "", plan.visualIdentity || "", plan.directorBrief || "", plan.audioPlan?.script || "", ...(plan.beats || []).flatMap((beat) => [beat.description || "", beat.eightElements?.action || ""])].join(" ");
    const color = /\bblack\b/i.test(evidence) ? "black " : "";
    if (/\bbikini\b/i.test(evidence)) return `${color}bikini`;
    if (/\b(?:swimsuit|swimwear)\b/i.test(evidence)) return `${color}swimsuit`;
    if (/\bdress\b/i.test(evidence)) return `${color}dress`;
    if (/\bshirt\b/i.test(evidence)) return `${color}shirt`;
    if (/\bjacket\b/i.test(evidence)) return `${color}jacket`;
    return `${color}garment`;
}

function looksEnglishStoryboardSpeech(value: string, language: string | undefined) {
    const normalizedLanguage = (language || "").trim().toLowerCase();
    return /english|\ben\b/.test(normalizedLanguage) || (!normalizedLanguage && Boolean(value) && !/[\u3400-\u9fff]/.test(value));
}

function compactStoryboardStageAction(beat: CommerceVideoBeat, plan: CanvasCommerceVideoPlan, maxWords: number) {
    const action = readableText(beat.eightElements?.action, "");
    const description = readableText(beat.description, fallbackBeatDescription(beat, plan));
    const usefulAction = /^continue only the described action\.?$/i.test(action) ? "" : action;
    return limitBeatWords(sanitizeStoryboardBeatDirection(usefulAction || description), maxWords);
}

function parsePlan(value: string): CanvasCommerceVideoPlan | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed as CanvasCommerceVideoPlan;
    } catch {
        return null;
    }
}

function extractJsonObjects(value: string) {
    const candidates: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (inString) {
            escaped = char === "\\" && !escaped;
            if (char === '"' && !escaped) inString = false;
            if (char !== "\\") escaped = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{") {
            if (depth === 0) start = index;
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                candidates.push(value.slice(start, index + 1));
                start = -1;
            }
        }
    }
    return candidates;
}

function limitWords(value: string, maxWords: number) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return value;
    return `${words.slice(0, maxWords).join(" ")}.`;
}

function limitBeatWords(value: string, maxWords: number) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return value;
    const selected = words.slice(0, maxWords);
    const danglingWord = /^(?:a|an|the|as|and|or|but|to|of|for|with|from|in|on|at|into|while|then|her|his|their|its|same|wearing)$/i;
    while (selected.length > Math.max(3, Math.floor(maxWords * 0.6)) && danglingWord.test(selected[selected.length - 1] || "")) selected.pop();
    return selected.join(" ").replace(/[,:;\-]+$/, "");
}

function normalizeSpaces(value: string) {
    return value.replace(/\s+/g, " ").trim();
}
