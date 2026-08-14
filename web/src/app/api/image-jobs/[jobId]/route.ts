import type { NextRequest } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { buildCanvasAttributionHeaders } from "@/lib/gateway/attribution";
import { currentAuthUser } from "@/lib/auth/route-utils";
import { authenticateCanvasApiKey } from "@/lib/auth/store";
import { refundGatewayReservation, reserveGatewayRequest, type GatewayReservation } from "@/lib/gateway/billing";
import { cancelImageJob, getImageJob, isImageJobOperation, isValidImageJobId, submitImageJob, toPublicImageJob } from "@/server/image-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ jobId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
    const { jobId } = await context.params;
    if (!isValidImageJobId(jobId)) return Response.json({ error: { message: "图片任务 ID 不合法" } }, { status: 400 });

    const operation = request.nextUrl.searchParams.get("operation") || "";
    if (!isImageJobOperation(operation)) return Response.json({ error: { message: "图片任务类型不支持" } }, { status: 400 });

    const contentType = request.headers.get("content-type") || "";
    if (!contentType) return Response.json({ error: { message: "图片任务缺少 Content-Type" } }, { status: 400 });

    let reservation: GatewayReservation | null = null;
    try {
        const identity = await authenticateCanvasApiKey(request.headers.get("authorization") || "");
        if (!identity) return Response.json({ error: { code: "invalid_canvas_key", message: "画布 Key 无效或已撤销" } }, { status: 401 });
        const existing = await getImageJob(jobId, identity.user.id);
        if (existing) return Response.json(toPublicImageJob(existing), { status: existing.status === "succeeded" ? 200 : 202, headers: { "Cache-Control": "no-store" } });
        const path = operation === "chat-completions" ? "v1/chat/completions" : `v1/images/${operation}`;
        reservation = await reserveGatewayRequest(request, path, { keyId: identity.keyId, userId: identity.user.id }, `image:${identity.user.id}:${jobId}`);
        const authorization = normalizeAuthorization(process.env.CANVAS_UPSTREAM_API_KEY || "");
        if (!authorization) {
            if (reservation) refundGatewayReservation(reservation, "模型服务尚未配置，积分退回");
            return Response.json({ error: { message: "模型服务授权尚未配置" } }, { status: 503 });
        }
        const job = await submitImageJob({
            id: jobId,
            operation,
            authorization,
            contentType,
            body: await request.arrayBuffer(),
            billingRequestId: reservation?.requestId,
            userId: identity.user.id,
            attributionHeaders: Object.fromEntries(buildCanvasAttributionHeaders({ userId: identity.user.id, username: identity.user.username }, `image:${identity.user.id}:${jobId}`).entries()),
        });
        // The persisted image job now owns settlement/refund for this reservation.
        reservation = null;
        return Response.json(toPublicImageJob(job), {
            status: job.status === "succeeded" ? 200 : 202,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        if (reservation) refundGatewayReservation(reservation, "图片任务提交失败，积分退回");
        return authErrorResponse(error);
    }
}

export async function GET(_request: NextRequest, context: RouteContext) {
    const { jobId } = await context.params;
    if (!isValidImageJobId(jobId)) return Response.json({ error: { message: "图片任务 ID 不合法" } }, { status: 400 });

    const user = await currentAuthUser();
    if (!user) return Response.json({ error: { message: "请先登录" } }, { status: 401 });
    const job = await getImageJob(jobId, user.id);
    if (!job) return Response.json({ error: { message: "图片任务不存在或已过期" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(toPublicImageJob(job), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    const { jobId } = await context.params;
    if (!isValidImageJobId(jobId)) return Response.json({ error: { message: "图片任务 ID 不合法" } }, { status: 400 });

    const user = await currentAuthUser();
    if (!user) return Response.json({ error: { message: "请先登录" } }, { status: 401 });
    const job = await cancelImageJob(jobId, user.id);
    if (!job) return Response.json({ error: { message: "图片任务不存在或已结束" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(toPublicImageJob(job), { headers: { "Cache-Control": "no-store" } });
}

function normalizeAuthorization(value: string | null) {
    const token = (value || "").trim();
    if (!token) return "";
    return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}
