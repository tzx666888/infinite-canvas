export const dynamic = "force-dynamic";

export function POST() {
    return Response.json(
        {
            error: "feature_moved",
            message: "配音能力已迁移到站内音频模型，请在画布中直接使用",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
    );
}
