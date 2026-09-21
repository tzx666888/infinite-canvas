import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { canvasDatabase } from "@/lib/auth/database";
import { requireAuthUser } from "@/lib/auth/route-utils";
import { resolveCanvasUpstreamAuthorization } from "@/lib/gateway/upstream-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const user = await requireAuthUser();
        const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const rows = canvasDatabase()
            .prepare("SELECT o.task_id, b.model FROM video_task_owners o JOIN billing_transactions b ON b.request_id = o.request_id WHERE o.user_id = ? AND b.status = 'refunded' AND b.model = 'sd30' AND b.created_at >= ? ORDER BY b.created_at DESC LIMIT 3")
            .all(user.id, since);
        const origin = (process.env.CANVAS_UPSTREAM_ORIGIN || process.env.TOKAXIS_INTERNAL_ORIGIN || "").replace(/\/+$/, "");
        const authorization = resolveCanvasUpstreamAuthorization();
        if (!origin || !authorization) return NextResponse.json({ tasks: [] }, { headers: { "Cache-Control": "no-store" } });
        const tasks = (await Promise.all(rows.map(async (row) => {
            const taskId = typeof row.task_id === "string" ? row.task_id : "";
            if (!taskId) return null;
            const response = await fetch(`${origin}/v1/videos/generations/${encodeURIComponent(taskId)}`, { headers: { Authorization: authorization }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
            const payload = await response.json().catch(() => null) as { data?: { status?: unknown }; status?: unknown } | null;
            const status = String(payload?.data?.status || payload?.status || "").toLowerCase();
            return response.ok && !["failed", "error", "expired", "cancelled", "canceled"].includes(status) ? { id: taskId, model: "sd30", provider: "video30" as const } : null;
        }))).filter((task): task is { id: string; model: string; provider: "video30" } => Boolean(task));
        return NextResponse.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
