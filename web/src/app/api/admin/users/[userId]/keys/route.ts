import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, requireRootUser } from "@/lib/auth/route-utils";
import { revokeManagedUserKeys } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        enforceSameOrigin(request);
        const root = await requireRootUser();
        const { userId } = await context.params;
        const result = await revokeManagedUserKeys({ rootUserId: root.id, userId });
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
