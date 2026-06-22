const FALLBACK_MODELS = [
    "gpt-image-2",
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
            channels: [{ id: "default", name: "TokAxis", models: FALLBACK_MODELS }],
            availableModels: FALLBACK_MODELS,
        },
    });
}
