import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, parseAuthBody, requireRootUser, stringInput } from "@/lib/auth/route-utils";
import { updateManagedUser } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        enforceSameOrigin(request);
        const root = await requireRootUser();
        const { userId } = await context.params;
        const body = await parseAuthBody(request);
        const displayName = body.displayName === undefined ? undefined : stringInput(body.displayName);
        const role = body.role === undefined ? undefined : (stringInput(body.role) as "admin" | "member");
        const status = body.status === undefined ? undefined : (stringInput(body.status) as "active" | "disabled");
        const user = await updateManagedUser({ rootUserId: root.id, userId, displayName, role, status });
        return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
