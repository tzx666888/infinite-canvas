import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, requireAuthUser } from "@/lib/auth/route-utils";
import { revokeCanvasApiKey } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ keyId: string }> }) {
    try {
        enforceSameOrigin(request);
        const user = await requireAuthUser();
        const { keyId } = await context.params;
        return NextResponse.json({ apiKey: await revokeCanvasApiKey(user.id, keyId) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
