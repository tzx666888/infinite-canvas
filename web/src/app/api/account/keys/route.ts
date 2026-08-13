import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, parseAuthBody, requireAuthUser, stringInput } from "@/lib/auth/route-utils";
import { createCanvasApiKey, listCanvasApiKeys } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const user = await requireAuthUser();
        return NextResponse.json({ apiKeys: await listCanvasApiKeys(user.id) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        enforceSameOrigin(request);
        const user = await requireAuthUser();
        const body = await parseAuthBody(request);
        return NextResponse.json(await createCanvasApiKey(user.id, stringInput(body.name)), { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
