const FALLBACK_MODELS = [
    "gpt-image-2",
    "gemini-3.1-flash-image",
    "grok-imagine-image-lite",
    "grok-imagine-video-1.5-fast",
    "grok-imagine-video-1.5-preview",
    "grok-imagine-video-1.5-1080p",
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
