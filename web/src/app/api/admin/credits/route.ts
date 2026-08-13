import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, numberInput, parseAuthBody, requireRootUser, stringInput } from "@/lib/auth/route-utils";
import { adjustUserCredits } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        enforceSameOrigin(request);
        const root = await requireRootUser();
        const body = await parseAuthBody(request);
        const result = await adjustUserCredits({ rootUserId: root.id, username: stringInput(body.username), amount: numberInput(body.amount), remark: stringInput(body.remark) });
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
