import { currentAuthUser } from "@/lib/auth/route-utils";
import { TOKAXIS_GPT_IMAGE_2_5_MODEL_IDS } from "@/lib/gpt-image";
import { TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS } from "@/lib/minimax-h3-video";
import { TOKAXIS_VIDEO30_MODEL_IDS } from "@/lib/video30";
import { ACTIVE_GOOGLE_VIDEO_MODEL_IDS } from "@/lib/video-providers/google-video";
import { PRODUCT_VIDEO_MODEL_IDS } from "@/lib/product-video-models";

const FALLBACK_MODELS = ["gpt-image-2", ...TOKAXIS_GPT_IMAGE_2_5_MODEL_IDS, ...ACTIVE_GOOGLE_VIDEO_MODEL_IDS, ...PRODUCT_VIDEO_MODEL_IDS, "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o-mini-tts", "tts-1"];
const ROOT_ONLY_MINIMAX_H3_MODEL = "MiniMax-H3-c4";

export async function GET() {
    const user = await currentAuthUser();
    const models = user?.role === "root" && user.username.trim().toLowerCase() === "root" ? [...FALLBACK_MODELS, ROOT_ONLY_MINIMAX_H3_MODEL] : FALLBACK_MODELS;
    return Response.json({
        ok: true,
        modelChannel: {
            baseUrl: "/api/gateway",
            channels: [{ id: "tokaxis", name: "平台模型", models }],
            availableModels: models,
        },
    });
}
