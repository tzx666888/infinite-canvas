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
    if (lower === "gemini-3.1-flash-image") return { label: "gemini-3.1-flash-image", badge: "Google" };
    if (lower === "grok-imagine-image-lite") return { label: "Grok Imagine Lite", badge: "Grok" };
    if (lower === "grok-imagine-video-1.5-fast") return { label: "Grok 视频 1.5", badge: "Grok" };
    if (lower === "grok-imagine-video-1.5-preview") return { label: "Grok 多参考图视频", badge: "Grok" };
    if (lower === "grok-imagine-video-1.5-1080p") return { label: "Grok 1.5 1080p", badge: "Grok" };

    return { label: value };
}
