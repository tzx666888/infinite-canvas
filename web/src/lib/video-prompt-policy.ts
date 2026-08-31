export type VideoPromptMode = "auto" | "commerce" | "direct";

export const videoPromptModeOptions: Array<{ value: VideoPromptMode; label: string }> = [
    { value: "auto", label: "智能" },
    { value: "commerce", label: "爆款 Hook" },
    { value: "direct", label: "原样直出" },
];

export function normalizeVideoPromptMode(value: string | undefined): VideoPromptMode {
    return value === "commerce" || value === "direct" ? value : "auto";
}

export function shouldSubmitRawVideoPrompt(prompt: string, mode: string | undefined) {
    const normalizedMode = normalizeVideoPromptMode(mode);
    if (normalizedMode === "direct") return true;
    if (normalizedMode === "commerce") return false;

    const direction = prompt.replace(/\s+/g, " ").trim();
    if (!direction) return false;
    if (direction.length > 600 || hasExplicitContinuousDirection(direction)) return true;

    const directionSignals = [
        /(?:rotate|rotating|rotation|orbit|dolly|push[-\s]?in|pull[-\s]?out|pan(?:ning)?|tilt|tracking|locked[-\s]?off|static camera|旋转|环绕|推镜|拉镜|摇镜|跟拍|固定镜头)/i,
        /(?:studio|background|backdrop|location|scene|set design|摄影棚|背景|场景|地点)/i,
        /(?:lighting|soft light|hard light|rim light|backlight|neon|daylight|光线|灯光|轮廓光|逆光|霓虹)/i,
        /(?:no\s+|without\s+|do not\s+|never\s+|禁止|不要|不得|严禁)/i,
        /(?:close[-\s]?up|medium shot|wide shot|macro|overhead|low[-\s]?angle|high[-\s]?angle|特写|中景|全景|微距|俯拍|仰拍)/i,
    ].filter((pattern) => pattern.test(direction)).length;

    return direction.length > 80 && directionSignals >= 3;
}

function hasExplicitContinuousDirection(prompt: string) {
    return /(?:one|single) continuous (?:camera move|shot|take)|single[-\s]?take|one[-\s]?take|uncut|no cuts?|without cuts?|一镜到底|连续单镜头|不要切镜|不切镜|无切镜/i.test(prompt);
}
