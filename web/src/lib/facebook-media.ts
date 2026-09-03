export const FACEBOOK_MEDIA_PRESETS = [
    { id: "FB-9:16", ratio: "9:16", width: 1080, height: 1920, sourceVideoSize: "720x1280" },
    { id: "FB-4:5", ratio: "4:5", width: 1080, height: 1350, sourceVideoSize: "720x1280" },
    { id: "FB1.91:1", ratio: "1.91:1", width: 1200, height: 628, sourceVideoSize: "1280x720" },
] as const;

export type FacebookMediaPresetId = (typeof FACEBOOK_MEDIA_PRESETS)[number]["id"];

export function facebookMediaPreset(value?: string) {
    return FACEBOOK_MEDIA_PRESETS.find((preset) => preset.id === value);
}

export function facebookMediaTargetSize(value?: string) {
    const preset = facebookMediaPreset(value);
    return preset ? `${preset.width}x${preset.height}` : value || "";
}

export function facebookVideoSourceSize(value?: string) {
    return facebookMediaPreset(value)?.sourceVideoSize || value || "";
}

export function facebookSeedanceSourceRatio(value?: string) {
    if (value === "FB-4:5") return "3:4";
    return facebookVideoSourceSize(value);
}

const FACEBOOK_45_SAFE_FRAME_MARKER = "FACEBOOK 4:5 DELIVERY SAFE FRAME:";
const FACEBOOK_45_SAFE_FRAME_PROMPT =
    `${FACEBOOK_45_SAFE_FRAME_MARKER} Compose for a final 4:5 deliverable. Keep every essential face, full head, hand, product, logo, generated caption, subtitle, and CTA inside the central 4:5 area. On a 9:16 source, keep the top and bottom 15% free of essential content.`;

export function facebookVideoSafeFramePrompt(prompt: string, requestedSize?: string, maxChars?: number) {
    const text = prompt.trim();
    if (requestedSize !== "FB-4:5" || text.includes(FACEBOOK_45_SAFE_FRAME_MARKER)) return text;
    if (!maxChars) return [text, FACEBOOK_45_SAFE_FRAME_PROMPT].filter(Boolean).join("\n\n");
    const separatorLength = text ? 2 : 0;
    const available = Math.max(0, maxChars - FACEBOOK_45_SAFE_FRAME_PROMPT.length - separatorLength);
    const safeText = text.length > available ? text.slice(0, available).trim() : text;
    return [safeText, FACEBOOK_45_SAFE_FRAME_PROMPT].filter(Boolean).join("\n\n");
}
