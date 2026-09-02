export type VideoPromptMode = "auto" | "commerce" | "direct";
export type VideoPromptDetail = "short" | "medium" | "detailed";

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

export function classifyVideoPromptDetail(prompt: string): VideoPromptDetail {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    const length = [...normalized].length;
    const timelineCount = normalized.match(/(?:^|\s)\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:s|sec(?:ond)?s?|秒)\s*[:：]?/gi)?.length || 0;
    const structuredBrief = timelineCount >= 2 || (/(?:total|duration|总时长|时长)\s*[:：]?\s*\d{1,2}\s*(?:s|sec(?:ond)?s?|秒)/i.test(normalized) && /(?:front[- ]only|no rotation|do not|absolutely no|严禁|不要|不得)/i.test(normalized));
    if (length > 600 || structuredBrief) return "detailed";
    if (length > 200) return "medium";
    return "short";
}

export function hasConcreteVideoOpening(prompt: string) {
    return /(?:0\s*[-–—]\s*\d|前\s*[一二三四五六七八九十0-9]+\s*秒|开头[^。；;]{0,48}(?:摔|跌|坠|撞|砸|爆|弹|倒|冻结|倒放|逆向|黑屏|掉落|冲入)|(?:hook|勾子)[^。；;]{0,48}(?:摔|跌|坠|撞|砸|爆|弹|倒|冻结|倒放|逆向|黑屏|掉落|冲入)|(?:stumble|fall|drop|crash|burst|freeze|reverse|black screen)[^.;]{0,48}(?:hook|opening))/i.test(prompt);
}

function hasExplicitContinuousDirection(prompt: string) {
    return /(?:one|single) continuous (?:camera move|shot|take)|single[-\s]?take|one[-\s]?take|uncut|no cuts?|without cuts?|一镜到底|连续单镜头|不要切镜|不切镜|无切镜/i.test(prompt);
}
