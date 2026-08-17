import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceRateLimit, clearRateLimit, requestAddress } from "@/lib/auth/rate-limit";
import { enforceSameOrigin, parseAuthBody, stringInput } from "@/lib/auth/route-utils";
import { createSessionToken, AUTH_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { registerWithInvite } from "@/lib/auth/store";
import { resolveCanvasUpstreamAuthorization } from "@/lib/gateway/upstream-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const clientKey = `register:${requestAddress(request)}`;
    try {
        enforceSameOrigin(request);
        enforceRateLimit(clientKey, 5);
        const body = await parseAuthBody(request);
        const credentials = { username: stringInput(body.username), password: stringInput(body.password) };
        const user = await registerWithInvite({ ...credentials, inviteCode: stringInput(body.inviteCode) });
        await resolveCanvasUpstreamAuthorization({ userId: user.id, username: user.username, displayName: user.displayName });
        clearRateLimit(clientKey);
        const response = NextResponse.json({ user });
        response.cookies.set(AUTH_COOKIE_NAME, createSessionToken(user.id), sessionCookieOptions());
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch (error) {
        return authErrorResponse(error);
    }
}
