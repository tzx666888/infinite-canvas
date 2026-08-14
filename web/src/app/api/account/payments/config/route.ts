import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { publicEpayConfig } from "@/lib/auth/epay";
import { requireAuthUser } from "@/lib/auth/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await requireAuthUser();
        return NextResponse.json(publicEpayConfig(), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
