import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin } from "@/lib/auth/route-utils";
import { AUTH_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        enforceSameOrigin(request);
        const response = NextResponse.json({ ok: true });
        response.cookies.set(AUTH_COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch (error) {
        return authErrorResponse(error);
    }
}
