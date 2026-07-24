import type { NextRequest } from "next/server";

import { isValidImageJobId, readImageJobResult } from "@/server/image-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ jobId: string; index: string }> | { jobId: string; index: string };
};

export async function GET(_request: NextRequest, context: RouteContext) {
    const { jobId, index: rawIndex } = await Promise.resolve(context.params);
    const index = Number(rawIndex);
    if (!isValidImageJobId(jobId) || !Number.isInteger(index) || index < 0) return Response.json({ error: { message: "图片结果地址不合法" } }, { status: 400 });

    const result = await readImageJobResult(jobId, index);
    if (!result) return Response.json({ error: { message: "图片结果不存在或已过期" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(result.bytes), {
        status: 200,
        headers: {
            "Cache-Control": "private, no-store",
            "Content-Type": result.mimeType,
            "Content-Length": String(result.bytes.byteLength),
        },
    });
}
