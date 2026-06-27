export type ModelDisplayInfo = {
    label: string;
    description?: string;
    badge?: string;
};

export function modelDisplayInfo(model: string): ModelDisplayInfo {
    const value = model.trim();
    const lower = value.toLowerCase();
    if (!value) return { label: "" };

    if (lower === "grok-imagine-video") {
        return {
            label: "Grok 视频",
            description: "适合创意短视频和动态镜头，当前支持 6s / 10s / 15s。",
            badge: "Grok",
        };
    }

    return { label: value };
}
