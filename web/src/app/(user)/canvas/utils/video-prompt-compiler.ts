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
    const category = readableText(plan.productCategory, "the product");
    const beatText = beats.map((beat) => describeBeat(beat, plan)).filter(Boolean);
    const actionChain = beatText.length
        ? beatText.map((text, index) => (index === 0 ? text : `then ${text}`)).join(", ")
        : `open with an exaggerated but believable social-ad hook for ${category}, reveal the product as the obvious solution, demonstrate proof, then finish with a product hero shot and a purchase cue`;
    const prompt = [
        `Create a ${context.duration}-second ${aspectText(context.aspectRatio)} commerce video for ${category}.`,
        `Use a direct-response short-video rhythm by percentage: 0-20% dramatic mishap, pain reaction, or visual shock; 20-35% product pushed into the foreground as the solution; 35-70% clear demo and proof; 70-100% result reassurance and final hero.`,
        `Use one continuous visual storyline: ${actionChain}.`,
        `Keep the subject consistent, the camera movement smooth, and the product clearly visible in every important moment.`,
        `Make the hook thumb-stopping with fast camera energy, expressive human reaction, sudden mess, visible pain point, or product-forward close-up when relevant, but keep it believable. If people appear, keep faces, hands, fingers, and body proportions anatomically stable.`,
        `Use realistic lighting, believable physical motion, and a clean conversion-focused ending that shows the product with the result without inventing claims.`,
        referenceConstraint(context.referenceMode),
        plan.enhancementWords || DEFAULT_ENHANCEMENT_WORDS,
        "Negative prompt: no fake medical claims, no fake endorsements, no unreadable text overlays, no distorted hands, no warped faces, no extra fingers, no melted people, no product/person hybrids, no duplicated subjects, no sudden scene jumps.",
    ]
        .filter(Boolean)
        .join(" ");
    return normalizeSpaces(limitWords(prompt, 220));
}

function compileVeoPrompt(plan: CanvasCommerceVideoPlan, beats: CommerceVideoBeat[], context: VideoPromptContext) {
    const category = readableText(plan.productCategory, "the product");
    const ranges = timelineRanges(beats.length || 1, context.duration);
    const lines = beats.length
        ? beats.map((beat, index) => {
              const range = ranges[index] || ranges[ranges.length - 1];
              const shotType = readableText(beat.shotType, "medium shot");
              const cameraMove = readableText(beat.cameraMove, "smooth camera movement");
              return `${range} ${shotType}, ${cameraMove}: ${describeBeat(beat, plan)}.`;
          })
        : [`${ranges[0]} medium shot, smooth camera movement: show a concrete commerce hook, a clear product demonstration, and a final product hero shot for ${category}.`];
    return normalizeSpaces(
        [
            `Create a ${context.duration}-second ${aspectText(context.aspectRatio)} commerce video for ${category}.`,
            ...lines,
            `Maintain consistent subject appearance, product shape, color, and scene logic across all shots.`,
            referenceConstraint(context.referenceMode),
            plan.enhancementWords || DEFAULT_ENHANCEMENT_WORDS,
            "Negative prompt: no fabricated certifications, no fake discounts, no exaggerated medical or beauty claims, no visible storyboard labels, no arrows, no grid panels, no watermarks.",
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
    const category = readableText(plan.productCategory, "the product");
    const hook = readableText(plan.hookDescription, `a high-specificity visual hook for ${category}`);
    if (beat.phase === "hook") return hook;
    if (beat.phase === "pain") return `show the real daily problem that makes ${category} relevant, without exaggerating or inventing claims`;
    if (beat.phase === "demo") return `show a clear hands-on product demonstration with the product visible and easy to understand`;
    if (beat.phase === "cta") return `finish with a clean product hero shot and a direct purchase cue`;
    return `show a clear visual beat that advances the product story`;
}

function aspectText(aspectRatio: VideoPromptContext["aspectRatio"]) {
    if (aspectRatio === "9:16") return "vertical 9:16 composition with the subject centered or slightly above center";
    if (aspectRatio === "16:9") return "horizontal 16:9 composition with enough environmental space around the subject";
    return "square 1:1 composition with compact centered framing";
}

function referenceConstraint(referenceMode: VideoPromptContext["referenceMode"]) {
    if (referenceMode === "i2v") return "Maintain visual continuity with the reference image: preserve subject appearance, color palette, and composition.";
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
