import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { currentAuthUser } from "@/lib/auth/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const user = await currentAuthUser();
        const response = NextResponse.json({ user });
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch (error) {
        return authErrorResponse(error);
    }
}
