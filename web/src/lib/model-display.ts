export type ModelDisplayInfo = {
    label: string;
    description?: string;
    badge?: string;
};

export function modelDisplayInfo(model: string): ModelDisplayInfo {
    const value = model.trim();
    const lower = value.toLowerCase();
    if (!value) return { label: "" };

    if (lower === "gpt-image-2") return { label: "GPT Image 2", badge: "OpenAI" };
    if (lower === "gemini-3.1-flash-image-1k") return { label: "Gemini 3.1 Flash Image 1K", badge: "Google" };
    if (lower === "gemini-3.1-flash-image-2k") return { label: "Gemini 3.1 Flash Image 2K", badge: "Google" };
    if (lower === "gemini-3.1-flash-image-4k") return { label: "Gemini 3.1 Flash Image 4K", badge: "Google" };
    if (lower === "grok-imagine-image-lite") return { label: "Grok Imagine Lite", badge: "Grok" };
    if (lower === "veo_3_1_t2v_fast_landscape") return { label: "Veo 3.1 文生视频 · 横屏", description: "纯文字生成；4、6、8 秒；1080p", badge: "Google" };
    if (lower === "veo_3_1_t2v_fast_portrait") return { label: "Veo 3.1 文生视频 · 竖屏", description: "纯文字生成；4、6、8 秒；1080p", badge: "Google" };
    if (lower === "veo_3_1_i2v_s_fast_fl") return { label: "Veo 3.1 首尾帧 · 横屏", description: "1–2 张参考图；4、6、8 秒；1080p", badge: "Google" };
    if (lower === "veo_3_1_i2v_s_fast_portrait_fl") return { label: "Veo 3.1 首尾帧 · 竖屏", description: "1–2 张参考图；4、6、8 秒；1080p", badge: "Google" };
    if (lower === "veo_3_1_r2v_fast_landscape") return { label: "Veo 3.1 多参考 · 横屏", description: "1–3 张参考图；固定 8 秒；1080p", badge: "Google" };
    if (lower === "veo_3_1_r2v_fast_portrait") return { label: "Veo 3.1 多参考 · 竖屏", description: "1–3 张参考图；固定 8 秒；1080p", badge: "Google" };
    if (lower === "veo_3_1_r2v_fast") return { label: "Veo 3.1 多参考 · 自适应", description: "1–3 张参考图；固定 8 秒；1080p", badge: "Google" };
    if (lower === "omni") return { label: "Omni 视频 · 横屏", description: "文字或 1–3 张参考图；固定 10 秒；720p", badge: "Google" };
    if (lower === "omni_portrait") return { label: "Omni 视频 · 竖屏", description: "文字或 1–3 张参考图；固定 10 秒；720p", badge: "Google" };
    if (lower === "grok-imagine-video-1.5-fast") return { label: "Grok Fast 视频", description: "无参考/单图 6、10、15 秒；2–7 图 6、10 秒；720p", badge: "Grok" };
    if (lower === "grok-imagine-video-1.5-preview") return { label: "Grok Preview 视频", description: "1–7 张参考图；6、10 秒；720p", badge: "Grok" };
    if (lower === "grok-imagine-video-1.5-1080p") return { label: "Grok 1080p 视频", description: "仅 1 张参考图；6、10 秒；固定 1080p", badge: "Grok" };

    return { label: value };
}
