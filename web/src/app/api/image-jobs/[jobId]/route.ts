import type { NextRequest } from "next/server";

import { cancelImageJob, getImageJob, isImageJobOperation, isValidImageJobId, submitImageJob, toPublicImageJob } from "@/server/image-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ jobId: string }> | { jobId: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
    const { jobId } = await Promise.resolve(context.params);
    if (!isValidImageJobId(jobId)) return Response.json({ error: { message: "图片任务 ID 不合法" } }, { status: 400 });

    const operation = request.nextUrl.searchParams.get("operation") || "";
    if (!isImageJobOperation(operation)) return Response.json({ error: { message: "图片任务类型不支持" } }, { status: 400 });

    const authorization = normalizeAuthorization(request.headers.get("authorization"));
    if (!authorization) return Response.json({ error: { message: "TokAxis API Key is required" } }, { status: 401 });

    const contentType = request.headers.get("content-type") || "";
    if (!contentType) return Response.json({ error: { message: "图片任务缺少 Content-Type" } }, { status: 400 });

    try {
        const job = await submitImageJob({
            id: jobId,
            operation,
            authorization,
            contentType,
            body: await request.arrayBuffer(),
        });
        return Response.json(toPublicImageJob(job), {
            status: job.status === "succeeded" ? 200 : 202,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "图片任务提交失败";
        return Response.json({ error: { message } }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}

export async function GET(_request: NextRequest, context: RouteContext) {
    const { jobId } = await Promise.resolve(context.params);
    if (!isValidImageJobId(jobId)) return Response.json({ error: { message: "图片任务 ID 不合法" } }, { status: 400 });

    const job = await getImageJob(jobId);
    if (!job) return Response.json({ error: { message: "图片任务不存在或已过期" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(toPublicImageJob(job), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    const { jobId } = await Promise.resolve(context.params);
    if (!isValidImageJobId(jobId)) return Response.json({ error: { message: "图片任务 ID 不合法" } }, { status: 400 });

    const job = await cancelImageJob(jobId);
    if (!job) return Response.json({ error: { message: "图片任务不存在或已结束" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(toPublicImageJob(job), { headers: { "Cache-Control": "no-store" } });
}

function normalizeAuthorization(value: string | null) {
    const token = (value || "").trim();
    if (!token) return "";
    return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}
