import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { requireAuthUser } from "@/lib/auth/route-utils";
import { getPaymentOrderForUser } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
    try {
        const user = await requireAuthUser();
        const { orderId } = await context.params;
        return NextResponse.json({ order: getPaymentOrderForUser(user.id, orderId) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
