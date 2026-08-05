import { TOKAXIS_GOOGLE_IMAGE_MODELS } from "@/lib/tokaxis-google-image";
import { TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS } from "@/lib/seedance-video";
import { GOOGLE_VIDEO_MODEL_IDS } from "@/lib/video-providers/google-video";

const FALLBACK_MODELS = [
    "gpt-image-2",
    TOKAXIS_GOOGLE_IMAGE_MODELS["4K"],
    ...GOOGLE_VIDEO_MODEL_IDS,
    ...TOKAXIS_SEEDANCE_VIDEO_MODEL_IDS,
    "gpt-5.6-sol",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-4o-mini-tts",
    "tts-1",
];

export function GET() {
    return Response.json({
        ok: true,
        modelChannel: {
            baseUrl: "/api/tokaxis",
            channels: [{ id: "tokaxis", name: "TokAxis", models: FALLBACK_MODELS }],
            availableModels: FALLBACK_MODELS,
        },
    });
}
