import type { GrokVideoReferenceMode, VideoAspectRatio } from "@/lib/video-model-settings";

export type VideoWorkbenchMode = "commerce" | "creative";

export type VideoWorkbenchPromptContext = {
    mode: VideoWorkbenchMode;
    model: string;
    duration: number;
    aspectRatio: VideoAspectRatio;
    referenceMode: GrokVideoReferenceMode;
    referenceCount: number;
    sourcePrompt: string;
};

export const VIDEO_WORKBENCH_PROMPT_MARKER = "WORKBENCH-DIRECTED VIDEO.";

const MAX_DIRECTION_WORDS = 72;

export function compileVideoWorkbenchPrompt(direction: string, context: VideoWorkbenchPromptContext) {
    const duration = Math.max(1, Math.floor(context.duration || 6));
    const referenceDirection = workbenchReferenceDirection(context.referenceMode, context.referenceCount);
    const audioDirection =
        context.mode === "commerce" && !requestsNoSpeech(context.sourcePrompt)
            ? [
                  "Audio lock: clear natural commercial speech, never silent or music-only.",
                  "Say the exact Spoken script once.",
                  "Lip-sync only the opening sentence on the same readable face, then continue the same voice off-screen over detail shots; never speak on a hidden or frozen mouth.",
              ].join(" ")
            : "Follow the requested sound design exactly. Do not invent dialogue when the direction requests ambient sound, music only, or silence.";

    return [
        VIDEO_WORKBENCH_PROMPT_MARKER,
        `Create exactly ${duration} seconds of polished ${aspectText(context.aspectRatio)} footage.`,
        referenceDirection,
        compactDirection(direction),
        audioDirection,
        "Preserve the adult face, hair, wardrobe, body proportions, product geometry, scale, colors, labels, object count, and background.",
        "Use hard cuts; no morphing, stretching, blending, duplicates, captions, prices, extra products, or invented claims.",
    ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

export function workbenchSpeechWordRange(duration: number): [number, number] {
    if (duration <= 6) return [10, 14];
    if (duration <= 10) return [18, 24];
    return [26, 34];
}

export function workbenchShotCount(duration: number) {
    if (duration <= 6) return 2;
    if (duration <= 10) return 3;
    return 4;
}

export function hasWorkbenchSpokenScript(prompt: string) {
    return /Spoken script\s*:\s*["“][^"”]+["”]/i.test(prompt);
}

export function requestsNoSpeech(prompt: string) {
    return /(?:no\s+(?:speech|dialogue|voice|narration)|silent\s+video|ambient[-\s]?only|music[-\s]?only|不要说话|无口播|无人声|纯音乐|只要环境音|静音)/i.test(prompt);
}

function workbenchReferenceDirection(mode: GrokVideoReferenceMode, referenceCount: number) {
    if (mode === "i2v") {
        return "Use the attached image as the exact opening-frame and identity anchor; start with restrained local motion before any clean cut.";
    }
    if (mode === "r2v") {
        if (referenceCount === 1) {
            return "Use the attached image as the exact identity, wardrobe, product, and scene anchor; keep every asset distinct and connect story stages with clean cuts.";
        }
        return `Use all ${Math.max(1, referenceCount)} images as ordered identity, wardrobe, product, and scene assets; select the right asset per shot, never blend them or treat a collage as the opening frame.`;
    }
    return "Build the opening from the described adult presenter, product, and scene, then preserve their identities and proportions.";
}

function aspectText(aspectRatio: VideoAspectRatio) {
    if (aspectRatio === "16:9") return "16:9 landscape";
    if (aspectRatio === "1:1") return "1:1 square";
    return "9:16 vertical";
}

function normalizeDirection(value: string) {
    return value
        .replace(/^\s*(?:WORKBENCH-DIRECTED VIDEO\.?\s*)/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function compactDirection(value: string) {
    const normalized = normalizeDirection(value);
    if (wordCount(normalized) <= MAX_DIRECTION_WORDS) return normalized;
    const scriptMatch = normalized.match(/Spoken script\s*:\s*["“][^"”]+["”]/i);
    if (!scriptMatch || scriptMatch.index === undefined) return limitWords(normalized, MAX_DIRECTION_WORDS);
    const script = scriptMatch[0];
    const visualDirection = `${normalized.slice(0, scriptMatch.index)} ${normalized.slice(scriptMatch.index + script.length)}`.replace(/\s+/g, " ").trim();
    const visualBudget = Math.max(12, MAX_DIRECTION_WORDS - wordCount(script));
    const compactVisual = limitWords(visualDirection, visualBudget).replace(/[.!?]+$/, "");
    return `${compactVisual}. ${script}`.trim();
}

function limitWords(value: string, maximum: number) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    return words.length <= maximum
        ? value.trim()
        : words
              .slice(0, maximum)
              .join(" ")
              .replace(/[,:;\-]+$/, "")
              .replace(/\b(?:and|or|with|while|then|as|to|of|for|the)$/i, "")
              .trim();
}

function wordCount(value: string) {
    return value.trim().split(/\s+/).filter(Boolean).length;
}
