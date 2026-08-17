import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { requireRootUser } from "@/lib/auth/route-utils";
import { getManagedUserDetails } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pageParam(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        const root = await requireRootUser();
        const { userId } = await context.params;
        const search = new URL(request.url).searchParams;
        const details = await getManagedUserDetails({
            rootUserId: root.id,
            userId,
            ledgerPage: pageParam(search.get("ledgerPage"), 1),
            paymentPage: pageParam(search.get("paymentPage"), 1),
            pageSize: pageParam(search.get("pageSize"), 20),
        });
        return NextResponse.json(details, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
