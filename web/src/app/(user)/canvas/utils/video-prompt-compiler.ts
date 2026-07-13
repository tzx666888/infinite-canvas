import type { CanvasCommerceVideoPlan } from "../types";

export type VideoTargetModel = "grok" | "veo";

export type VideoPromptContext = {
    model: VideoTargetModel;
    duration: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
    referenceMode: "t2v" | "i2v" | "r2v";
};

type CommerceVideoBeat = NonNullable<CanvasCommerceVideoPlan["beats"]>[number];

const DEFAULT_ENHANCEMENT_WORDS =
    "4K ultra HD, cinematic quality, natural body proportions, smooth continuous motion, no frame skipping, consistent appearance throughout";

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
        identityConstraint(plan, mode),
        locationConstraint(plan, mode, true),
        referenceConstraint(context.referenceMode, plan, mode),
        "Output clean full-frame footage with stable anatomy and rigid-object geometry: no grid, labels, captions, morphing, duplicated subjects, or unrelated entities.",
    ]
        .filter(Boolean)
        .join(" ");
    return normalizeSpaces(limitWords(prompt, 125));
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
    const beatWordBudget = Math.max(14, Math.floor(90 / Math.max(1, beats.length)));
    const beatText = beats
        .map((beat) => describeBeat(beat, plan))
        .filter(Boolean)
        .map((text) => limitWords(text, beatWordBudget));
    const actionChain = beatText.length
        ? beatText.map((text, index) => (index === 0 ? text : `then ${text}`)).join(", ")
        : fallbackActionChain(plan, mode, category);
    const prompt = [
        videoOpening(mode, context, category),
        videoRhythm(mode),
        identityConstraint(plan, mode),
        locationConstraint(plan, mode, false),
        `Use one continuous visual storyline: ${actionChain}.`,
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
            .join("\n")
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

function resolveStoryboardMode(plan: CanvasCommerceVideoPlan): NonNullable<CanvasCommerceVideoPlan["storyboardMode"]> {
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
    if (mode === "apparel") return `open on the referenced adult model and ${category}, progress through natural garment movement, fit details, and clean cuts across related lifestyle locations, then finish with the same model and garment in a strong closing frame`;
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
    if (mode === "apparel") return "Use an energetic lifestyle-montage rhythm: a strong face, silhouette, or motion hook; varied full-body, tracking, and material-detail shots; clean editorial cuts through the related locations in the ordered beats; then a confident apparel hero finish.";
    if (mode === "subject") return "Use an energetic cinematic-subject rhythm: strong first image, varied camera distance, clear physical progression, related-location cuts, and a memorable visual payoff. Do not force a commercial problem, rescue product, demonstration, or purchase cue.";
    if (mode === "scene") return "Use a high-retention scene-progression rhythm: strong establishing image, visible event and spatial progression, varied scale and camera direction, then a coherent environmental payoff.";
    return "Use a high-retention product rhythm by percentage: 0-20% reference-supported hook; 20-70% real use, construction, or visible detail from the ordered beats; 70-100% clear result or product finish. Do not invent mess, rescue, cleaning, or before/after actions.";
}

function identityConstraint(plan: CanvasCommerceVideoPlan, mode: NonNullable<CanvasCommerceVideoPlan["storyboardMode"]>) {
    const lock = readableText(plan.visualIdentity, "");
    const forbidden = (plan.forbiddenAdditions || []).map((item) => readableText(item, "")).filter(Boolean).join(", ");
    const modeRule =
        mode === "apparel"
            ? "The worn garment is the product; never add a bottle, package, cleaner, tool, foam, wiping action, or unrelated prop."
            : mode === "subject" || mode === "scene"
              ? "No product is required; never invent packaging, brands, bottles, tools, or purchase gestures."
              : "Use only the exact referenced product and never replace it with another category.";
    return [
        lock ? `Identity lock: ${lock}.` : "Maintain exact visual identity across all shots.",
        modeRule,
        forbidden ? `Forbidden additions: ${forbidden}.` : "",
    ].filter(Boolean).join(" ");
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
        const environmentRule = resolveLocationStrategy(plan, mode) === "single-location" ? "preserve the reference environment" : "use the reference for opening identity and composition, then follow only the related locations explicitly planned in the beats";
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
            if (char === "\"" && !escaped) inString = false;
            if (char !== "\\") escaped = false;
            continue;
        }
        if (char === "\"") {
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
