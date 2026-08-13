import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { requireAuthUser } from "@/lib/auth/route-utils";
import { walletSummary } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const user = await requireAuthUser();
        return NextResponse.json(await walletSummary(user.id), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
