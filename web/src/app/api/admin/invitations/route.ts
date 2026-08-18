import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, numberInput, parseAuthBody, requireAdminUser, stringInput } from "@/lib/auth/route-utils";
import { createInvite, listInvites } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const actor = await requireAdminUser();
        const invites = await listInvites(actor.id);
        return NextResponse.json({ invites }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        enforceSameOrigin(request);
        const actor = await requireAdminUser();
        const body = await parseAuthBody(request);
        const expiresInDays = body.expiresInDays === null ? null : numberInput(body.expiresInDays);
        const created = await createInvite({
            actorUserId: actor.id,
            label: stringInput(body.label),
            maxUses: numberInput(body.maxUses),
            expiresInDays,
            billingProfileId: stringInput(body.billingProfileId) || null,
        });
        return NextResponse.json(created, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
