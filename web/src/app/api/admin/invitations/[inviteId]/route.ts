import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, requireAdminUser } from "@/lib/auth/route-utils";
import { revokeInvite } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ inviteId: string }> }) {
    try {
        enforceSameOrigin(request);
        const actor = await requireAdminUser();
        const { inviteId } = await context.params;
        const invite = await revokeInvite({ actorUserId: actor.id, inviteId });
        return NextResponse.json({ invite }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
