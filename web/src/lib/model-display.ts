export type ModelDisplayInfo = {
    label: string;
    description?: string;
    badge?: string;
};

export const TOKAXIS_VERIFIED_VEO_MODELS = [
    "veo_3_1_i2v_s_fast_fl",
    "veo_3_1_i2v_s_fast_portrait_fl",
    "veo_3_1_r2v_fast",
    "veo_3_1_r2v_fast_landscape",
    "veo_3_1_r2v_fast_portrait",
    "veo_3_1_t2v_fast_landscape",
    "veo_3_1_t2v_fast_portrait",
] as const;

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

    if (lower.startsWith("veo_3_1_t2v")) {
        return {
            label: `Veo 文生视频 · ${modelOrientationLabel(lower)}`,
            description: "只用文字提示词生成视频，不需要参考图。",
            badge: "文生",
        };
    }

    if (lower.startsWith("veo_3_1_i2v")) {
        return {
            label: `Veo 首尾帧 · ${modelOrientationLabel(lower)}`,
            description: "支持 1-2 张图：1 张做首帧，2 张控制首尾帧。",
            badge: "首尾帧",
        };
    }

    if (lower.startsWith("veo_3_1_r2v")) {
        const orientation = lower === "veo_3_1_r2v_fast" ? "默认" : modelOrientationLabel(lower);
        return {
            label: `Veo 多参考图 · ${orientation}`,
            description: "支持最多 3 张参考图，适合保持人物、产品或风格一致。",
            badge: "多图",
        };
    }

    return { label: value };
}

function modelOrientationLabel(model: string) {
    return model.includes("portrait") ? "竖屏" : "横屏";
}
