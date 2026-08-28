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
