import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { requireRootUser } from "@/lib/auth/route-utils";
import { getAdminOverview } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const root = await requireRootUser();
        return NextResponse.json(getAdminOverview(root.id), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
