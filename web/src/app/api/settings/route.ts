import { TOKAXIS_GOOGLE_IMAGE_MODELS } from "@/lib/tokaxis-google-image";
import { TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS } from "@/lib/minimax-h3-video";
import { ACTIVE_GOOGLE_VIDEO_MODEL_IDS } from "@/lib/video-providers/google-video";

const FALLBACK_MODELS = ["gpt-image-2", TOKAXIS_GOOGLE_IMAGE_MODELS["4K"], ...ACTIVE_GOOGLE_VIDEO_MODEL_IDS, ...TOKAXIS_MINIMAX_H3_VIDEO_MODEL_IDS, "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o-mini-tts", "tts-1"];

export function GET() {
    return Response.json({
        ok: true,
        modelChannel: {
            baseUrl: "/api/gateway",
            channels: [{ id: "tokaxis", name: "平台模型", models: FALLBACK_MODELS }],
            availableModels: FALLBACK_MODELS,
        },
    });
}
