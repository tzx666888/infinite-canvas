import type { CanvasCommerceVideoPlan } from "../types";

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

export function compileStoryboardAudioDirection(plan: CanvasCommerceVideoPlan | undefined, sourcePrompt = "", duration = 15): string {
    const audioPlan = plan?.audioPlan;
    const userDirection = [sourcePrompt, plan?.directorBrief || ""].join(" ");
    if (audioPlan?.mode === "ambient-only" || requestsAmbientOnly(userDirection)) {
        return "Audio lock: use only natural location sound, restrained sound effects, and low background music. Generate no speech, dialogue, narration, singing, captions, or subtitles.";
    }

    const evidence = [userDirection, plan?.visualIdentity || "", ...(plan?.beats || []).map((beat) => beat.description || "")].join(" ");
    const hasVisiblePresenter = plan?.storyboardMode === "apparel" || plan?.storyboardMode === "subject" || visiblePresenterPattern.test(evidence);
    // Saved plans from before audioPlan existed should behave like the proven
    // presenter-led I2V workflow, not silently fall back to detached narration.
    const mode = audioPlan?.mode || (hasVisiblePresenter ? "on-camera" : "voiceover");
    const voice = compactSpeechText(audioPlan?.voice || "", 180) || inferredVoiceDirection(evidence);
    const script = compactSpeechText(audioPlan?.script || "", 520);
    const fallbackLanguage = script ? audioPlan?.language : resolveFallbackSpeechLanguage(plan, userDirection);
    const languageDirection = storyboardLanguageDirection(fallbackLanguage, userDirection);

    // Older saved storyboards do not have an audioPlan. The proven July 10
    // single-reference I2V result let Grok compose short lines around visible
    // performances instead of forcing narration across every visual beat.
    if (!audioPlan && hasVisiblePresenter) {
        return [
            "Audio and speech lock: generate clear audible commercial speech in the final audio track; do not return a silent or music-only video.",
            voice,
            languageDirection,
            compileLegacyPresenterSpeechSchedule(duration),
            "Write exactly one short, natural, evidence-safe sales phrase per scheduled window, with no second sentence or added clause; for Mandarin use at most 12 Han characters per phrase. Generate voice and face together with synchronized lips, jaw, cheeks, breath, and expression.",
            "Use no off-screen voiceover and no speech outside the scheduled windows. No captions, subtitles, invented prices, certifications, brand wording, testimonials, medical claims, or unsupported benefits.",
        ].join(" ");
    }

    const timingDirection = compileWholeVideoSpeechTiming(plan, duration, Boolean(script), userDirection);
    const performance =
        mode === "on-camera"
            ? "The same visible adult presenter performs every spoken cue on camera. Keep the face clearly visible and looking toward the camera for the complete line, with natural synchronized lips, jaw, cheeks, breath, and facial micro-expressions. Put detail close-ups, back views, and silent reaction holds only between cue lines. Never use off-screen voiceover for a quoted cue and never play speech over a frozen mouth or static smile."
            : mode === "mixed"
              ? "Perform every cue assigned to the visible adult presenter on camera with the face clearly visible for the complete line and natural synchronized lips, jaw, and facial motion. Use off-screen voiceover only for a beat explicitly written as narration with no presenter spokenLine; place detail shots and back views between spoken cues. Never play speech over a frozen mouth or static smile."
              : "Use off-screen voiceover. Do not animate a visible mouth unless an explicit beat line is assigned to that presenter.";
    const scriptDirection = timingDirection
        ? "Perform each exact cue line once with natural conversational emphasis; do not paraphrase it or read any production instruction aloud."
        : script
          ? mode === "on-camera"
              ? `Perform this exact spoken script once, naturally, across two or three close or medium face shots: "${script}" Choose phrase breaks that fit the visible performance; keep non-face shots silent.`
              : `Perform this exact spoken script once, naturally, without paraphrasing or reading production instructions: "${script}"`
          : `Write and perform one concise, evidence-safe commercial script of about ${speechWordBudget(duration)} English words or equivalent cadence, using only visible facts and the requested actions.`;

    return [
        "Audio and speech lock: generate clear audible commercial speech in the final audio track; do not return a silent or music-only video.",
        voice,
        languageDirection,
        timingDirection,
        performance,
        scriptDirection,
        "Keep music below the voice. No captions, subtitles, invented prices, discounts, certifications, brand wording, testimonials, medical claims, or unsupported benefits.",
    ].join(" ");
}

function compileLegacyPresenterSpeechSchedule(duration: number) {
    const seconds = Math.max(4, Math.min(15, Math.round(duration || 15)));
    if (seconds <= 8) {
        const firstStart = formatSpeechTime(seconds * 0.08);
        const firstEnd = formatSpeechTime(seconds * 0.36);
        const finalStart = formatSpeechTime(seconds * 0.66);
        const finalEnd = formatSpeechTime(seconds * 0.97);
        return `MANDATORY ON-CAMERA SPEECH SCHEDULE: ${firstStart}-${firstEnd}s first face-to-camera sales line; ${finalStart}-${finalEnd}s second face-to-camera CTA. Reuse one identical stationary front-facing chest-up presenter setup in every speech window: exact same face, hair state, camera, focal length, and lighting; shoulders square, full face and mouth visible, no walking, profile, or turn-away. Hold the shot until the voice and mouth stop. Every other time range is silent B-roll. Never speak during a torso-only, product-only, back, face-hidden, detail, or transition shot.`;
    }

    const firstStart = formatSpeechTime(seconds * 0.05);
    const firstEnd = formatSpeechTime(seconds * 0.25);
    const secondStart = formatSpeechTime(seconds * 0.28);
    const secondEnd = formatSpeechTime(seconds * 0.5);
    const finalStart = formatSpeechTime(seconds * 0.78);
    const finalEnd = formatSpeechTime(seconds * 0.98);
    return `MANDATORY ON-CAMERA SPEECH SCHEDULE: ${firstStart}-${firstEnd}s first face-to-camera sales line; ${secondStart}-${secondEnd}s second face-to-camera benefit line; ${finalStart}-${finalEnd}s final face-to-camera CTA. Reuse one identical stationary front-facing chest-up presenter setup in every speech window: exact same face, hair state, camera, focal length, and lighting; shoulders square, full face and mouth visible, no walking, profile, or turn-away. Hold the shot until the voice and mouth stop. Every other time range, especially ${secondEnd}-${finalStart}s, is silent B-roll. Never speak during a torso-only, product-only, back, face-hidden, detail, or transition shot.`;
}

function formatSpeechTime(value: number) {
    return (Math.round(value * 10) / 10).toFixed(1);
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
    const fullScript = compactSpeechText(audioPlan?.script || "", 420);
    if (audioPlan?.mode === "on-camera" && !spokenLine) {
        return "This is a silent B-roll beat. Generate no speech, dialogue, narration, or singing; use only natural location sound and low background music. Do not animate the presenter as if speaking.";
    }
    const speech = spokenLine
        ? `Say exactly this line once: "${spokenLine}"`
        : fullScript
          ? `Perform only one short phrase from this full narration that directly matches this beat, without repeating the whole script: "${fullScript}"`
          : `Create and perform one evidence-safe line of at most ${Math.max(6, Math.min(14, Math.round(duration * 1.8)))} words describing only this beat's visible action.`;
    const delivery =
        audioPlan?.mode === "on-camera" || (audioPlan?.mode !== "voiceover" && visiblePresenterPattern.test(evidence))
            ? "The visible adult presenter speaks with natural synchronized lips and facial motion."
            : "Use off-screen voiceover and do not make a visible presenter fake the narration.";
    return `Generate clear audible speech for this clip. ${languageDirection} ${voice} ${speech} ${delivery} Keep music below the voice; no captions, unsupported claims, or spoken production instructions.`;
}

export function selectBeatsForDuration(beats: CanvasCommerceVideoPlan["beats"], duration: number): CanvasCommerceVideoPlan["beats"] {
    const orderedBeats = orderBeats(beats);
    if (!orderedBeats.length) return [];
    if (duration <= 4) return pickBeatsByPhase(orderedBeats, ["hook", "cta"], 2);
    if (duration <= 8) return pickBeatsByPhase(orderedBeats, ["hook", "pain", "cta"], 3);
    if (duration <= 12) return pickBeatsByPhase(orderedBeats, ["hook", "pain", "demo", "cta"], 4);
    if (orderedBeats.length <= 7) return orderedBeats;

    const hook = findBeatByPhase(orderedBeats, "hook") || orderedBeats[0];
    const cta = findLastBeatByPhase(orderedBeats, "cta") || orderedBeats[orderedBeats.length - 1];
    const middle = orderedBeats.filter((beat) => beat !== hook && beat !== cta);
    return orderBeats([hook, ...pickEvenly(middle, 5), cta]);
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

function compileGrokPrompt(plan: CanvasCommerceVideoPlan, beats: CommerceVideoBeat[], context: VideoPromptContext) {
    const mode = resolveStoryboardMode(plan);
    const category = readableText(plan.productCategory, mode === "product" ? "the referenced product" : "the referenced subject");
    const beatWordBudget = Math.max(10, Math.floor(65 / Math.max(1, beats.length)));
    const beatText = beats
        .map((beat) => describeBeat(beat, plan))
        .filter(Boolean)
        .map((text) => limitWords(text, beatWordBudget));
    const actionChain = beatText.length ? beatText.map((text, index) => (index === 0 ? text : `then ${text}`)).join(", ") : fallbackActionChain(plan, mode, category);
    const prompt = [
        videoOpening(mode, context, category),
        `Use one edited sequence of distinct shots joined only by instantaneous hard cuts: ${actionChain}.`,
        locationConstraint(plan, mode, false),
        identityConstraint(plan, mode),
        videoRhythm(mode),
        `Make the opening immediately readable using only actions, people, garments, products, props, and scenery that exist in the reference or ordered beats. Keep faces, hands, fingers, clothing, rigid objects, and body proportions anatomically stable; use clean cuts and never morph between people and objects.`,
        endingConstraint(mode),
        referenceConstraint(context.referenceMode, plan, mode),
        plan.enhancementWords || DEFAULT_ENHANCEMENT_WORDS,
        "Negative prompt: no unrelated products, no invented bottles, no invented packaging, no category substitution, no imported props, no fake medical claims, no fake endorsements, no unreadable text overlays, no distorted hands, no warped faces, no extra fingers, no melted people, no product/person hybrids, no duplicated subjects, no autonomous unrelated scenes.",
    ]
        .filter(Boolean)
        .join(" ");
    return normalizeSpaces(limitWords(prompt, 220));
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
    return "Use the user's requested language. If the package or market is Chinese, speak natural Mandarin Chinese even when production directions are English. Keep one language and speaker.";
}

function compileWholeVideoSpeechTiming(plan: CanvasCommerceVideoPlan | undefined, duration: number, hasExactScript: boolean, userDirection: string) {
    const beats = orderBeats(plan?.beats);
    if (!beats.length) return "";
    const audioMode = plan?.audioPlan?.mode;
    const presenterCueBeats = beats.filter((beat) => compactSpeechText(beat.spokenLine || "", 110));
    if ((audioMode === "on-camera" || audioMode === "mixed") && presenterCueBeats.length) {
        const selectedCueBeats = presenterCueBeats.length <= 6 ? presenterCueBeats : pickEvenly(presenterCueBeats, 6);
        const allParsedRanges = beats.map((beat) => parseSpeechTimeRange(beat.timeRange));
        const plannedEnd = Math.max(0, ...allParsedRanges.map((range) => range?.end || 0));
        const timeScale = plannedEnd > 0 && Math.abs(plannedEnd - duration) > 0.25 ? duration / plannedEnd : 1;
        const cues = selectedCueBeats.map((beat) => {
            const parsedRange = parseSpeechTimeRange(beat.timeRange);
            const range = parsedRange ? `${formatCueSecond(parsedRange.start * timeScale)}-${formatCueSecond(parsedRange.end * timeScale)}s` : "a dedicated face shot";
            return `${range} the same presenter faces the camera and says '${compactSpeechText(beat.spokenLine || "", 110)}'`;
        });
        const silentRanges = beats
            .filter((beat) => !compactSpeechText(beat.spokenLine || "", 110))
            .map((beat) => parseSpeechTimeRange(beat.timeRange))
            .filter((range): range is { start: number; end: number } => Boolean(range))
            .map((range) => `${formatCueSecond(range.start * timeScale)}-${formatCueSecond(range.end * timeScale)}s`);
        const silenceRule = silentRanges.length ? ` Keep ${silentRanges.join(", ")} silent with ambience or low music only.` : "";
        return `On-camera cue timing: ${cues.join("; ")}. Keep the face visible and do not cut away until each quoted line ends.${silenceRule}`;
    }
    if (audioMode === "on-camera" && hasExactScript) return "";
    const selectedBeats = beats.length <= 6 ? beats : pickEvenly(beats, 6);
    const usesLegacyFallback = !hasExactScript && selectedBeats.every((beat) => !compactSpeechText(beat.spokenLine || "", 110));
    const beatGroups = usesLegacyFallback ? groupLegacySpeechBeats(selectedBeats) : selectedBeats.map((beat) => [beat]);
    const fallbackRanges = timelineRanges(beatGroups.length, duration);
    const parsedRanges = beatGroups.map((group) => {
        const first = parseSpeechTimeRange(group[0].timeRange);
        const last = parseSpeechTimeRange(group[group.length - 1].timeRange);
        return first && last ? { start: first.start, end: last.end } : null;
    });
    const plannedEnd = Math.max(0, ...parsedRanges.map((range) => range?.end || 0));
    const timeScale = plannedEnd > 0 && Math.abs(plannedEnd - duration) > 0.25 ? duration / plannedEnd : 1;
    const cues = beatGroups.map((group, index) => {
        const beat = group[0];
        const parsedRange = parsedRanges[index];
        const range = parsedRange ? `${formatCueSecond(parsedRange.start * timeScale)}-${formatCueSecond(parsedRange.end * timeScale)}s` : fallbackRanges[index];
        const spokenLine = compactSpeechText(beat.spokenLine || "", 110);
        if (spokenLine) return `${range} say '${spokenLine}'`;
        if (!hasExactScript) {
            const originalIndex = selectedBeats.indexOf(beat);
            return `${range} say '${legacyFallbackSpokenLine(plan || {}, beat, originalIndex, selectedBeats, userDirection, group.length > 1)}'`;
        }
        const phase = compactSpeechText(beat.phase || "beat", 24);
        const cueMeaning = compactSpeechText(limitWords(beat.description || fallbackBeatDescription(beat, plan || {}), 12).replace(/[,:;.!?]+$/, "."), 100);
        return `${range} ${phase}: one brief target-language phrase conveying '${cueMeaning}'`;
    });
    const scriptRule = hasExactScript ? "Place each script clause in its matching cue." : "Say each quoted cue line exactly once in its assigned range. Never replace it with director notes or production terminology.";
    const closingRule = beatGroups.some((group) => group.length > 1) ? "Keep the final combined demonstration-and-CTA sentence intact, then leave a brief music-backed visual hold." : "Do not front-load or finish before the penultimate cue.";
    return `Narration timing lock: ${cues.join("; ")}. ${scriptRule} Keep every phrase inside its shot and pause naturally at each cut. ${closingRule}`;
}

function groupLegacySpeechBeats(beats: CommerceVideoBeat[]) {
    if (beats.length < 5) return beats.map((beat) => [beat]);
    const penultimate = beats[beats.length - 2];
    const last = beats[beats.length - 1];
    if ((penultimate.phase || "").toLowerCase() !== "demo" || (last.phase || "").toLowerCase() !== "cta") return beats.map((beat) => [beat]);
    return [...beats.slice(0, -2).map((beat) => [beat]), [penultimate, last]];
}

function resolveFallbackSpeechLanguage(plan: CanvasCommerceVideoPlan | undefined, userDirection: string) {
    const explicit = compactSpeechText(plan?.audioPlan?.language || "", 80);
    if (explicit) return explicit;
    const spokenLines = (plan?.beats || [])
        .map((beat) => beat.spokenLine || "")
        .join(" ")
        .trim();
    if (spokenLines) return /[\u3400-\u9fff]/.test(spokenLines) ? "Mandarin Chinese" : "English";
    if (/[\u3400-\u9fff]/.test(userDirection)) return "Mandarin Chinese";
    // Saved 3.0 plans predate audioPlan. The product currently targets a
    // Chinese UI/market, so make their generated fallback script deterministic.
    return "Mandarin Chinese";
}

function legacyFallbackSpokenLine(plan: CanvasCommerceVideoPlan, beat: CommerceVideoBeat, index: number, selectedBeats: CommerceVideoBeat[], userDirection: string, combinesCta = false) {
    const language = resolveFallbackSpeechLanguage(plan, userDirection).toLowerCase();
    const usesMandarin = /mandarin|chinese|中文|普通话|汉语/.test(language);
    const mode = resolveStoryboardMode(plan);
    const phase = (beat.phase || "").toLowerCase();
    const demoIndex = selectedBeats.slice(0, index + 1).filter((item) => (item.phase || "").toLowerCase() === "demo").length - 1;
    const lines = usesMandarin ? legacyMandarinLines(mode) : legacyEnglishLines(mode);
    if (combinesCta && phase === "demo") return lines.demoCta;
    if (phase === "hook") return lines.hook;
    if (phase === "pain") return lines.pain;
    if (phase === "cta") return lines.cta;
    return lines.demo[Math.max(0, demoIndex) % lines.demo.length];
}

function legacyMandarinLines(mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    if (mode === "apparel") {
        return {
            hook: "看，这套一上身就很亮眼。",
            pain: "选衣服，款式和细节都要看清。",
            demo: ["近一点看，做工细节都很清楚。", "正面侧面都看一遍，整体更直观。"],
            cta: "喜欢这套造型，就选它吧。",
            demoCta: "正面侧面都看一遍，整体更直观，喜欢这套就选它吧。",
        };
    }
    if (mode === "subject") {
        return {
            hook: "先看这个瞬间，氛围一下就来了。",
            pain: "换个角度，人物状态更清楚。",
            demo: ["动作自然展开，画面更有层次。", "从近景到全身，节奏连贯又舒服。"],
            cta: "喜欢这种风格，就继续看下去吧。",
            demoCta: "从近景到全身，节奏连贯又舒服，喜欢这种感觉就继续看吧。",
        };
    }
    if (mode === "scene") {
        return {
            hook: "第一眼，这个空间就很有感觉。",
            pain: "顺着动线走，空间层次慢慢展开。",
            demo: ["细节和光线，让氛围更加完整。", "换个角度，整个场景看得更清楚。"],
            cta: "喜欢这样的环境，就来看看吧。",
            demoCta: "换个角度，整个场景看得更清楚，喜欢这里就来看看吧。",
        };
    }
    return {
        hook: "这个日常小麻烦，你也遇到过吗？",
        pain: "别急，解决方法就在这里。",
        demo: ["跟着画面操作，每一步都很清楚。", "前后变化，现在看得很清楚。"],
        cta: "需要的话，现在就去看看吧。",
        demoCta: "前后变化，现在看得很清楚，需要的话就去看看吧。",
    };
}

function legacyEnglishLines(mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    if (mode === "apparel") {
        return {
            hook: "Look, this outfit stands out instantly.",
            pain: "Fit and design details really matter.",
            demo: ["See the cut and design up close.", "Check the complete look from every angle."],
            cta: "Love this style? Make it yours.",
            demoCta: "Check the complete look from every angle, and make it yours if you love it.",
        };
    }
    if (mode === "subject") {
        return {
            hook: "Watch this moment come to life.",
            pain: "A new angle reveals more character.",
            demo: ["Natural movement gives every shot more depth.", "The sequence flows smoothly from close to wide."],
            cta: "Love this style? Keep watching.",
            demoCta: "The sequence flows smoothly from close to wide, so keep watching if you love this style.",
        };
    }
    if (mode === "scene") {
        return {
            hook: "This space makes an instant impression.",
            pain: "Follow the path as each layer opens up.",
            demo: ["Light and detail complete the atmosphere.", "A new angle reveals the whole setting."],
            cta: "Like this setting? Come take a closer look.",
            demoCta: "A new angle reveals the whole setting, so come take a closer look if you like it.",
        };
    }
    return {
        hook: "Do you deal with this everyday problem too?",
        pain: "Here is a clear way to handle it.",
        demo: ["Follow the steps shown right here.", "Now the visible change is easy to see."],
        cta: "Need one? Take a closer look today.",
        demoCta: "Now the visible change is easy to see, so take a closer look if you need one.",
    };
}

function parseSpeechTimeRange(value: string) {
    const match = value.match(/(\d+(?:\.\d+)?)\s*s?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*s?/i);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function formatCueSecond(value: number) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function speechWordBudget(duration: number) {
    if (duration <= 6) return "10-14";
    if (duration <= 10) return "18-24";
    if (duration <= 15) return "26-34";
    return `${Math.max(26, Math.round(duration * 1.8))}-${Math.max(34, Math.round(duration * 2.2))}`;
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

function normalizeSpaces(value: string) {
    return value.replace(/\s+/g, " ").trim();
}
