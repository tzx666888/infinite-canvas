import { NextResponse } from "next/server";

import { AuthError, authErrorResponse } from "@/lib/auth/auth-error";
import { enforceRateLimit, clearRateLimit, requestAddress } from "@/lib/auth/rate-limit";
import { enforceSameOrigin, parseAuthBody, stringInput } from "@/lib/auth/route-utils";
import { createSessionToken, AUTH_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { authenticateLocalUser, claimExternalAccount } from "@/lib/auth/store";
import { tokaxisAuthError, verifyTokaxisCredentials } from "@/lib/auth/tokaxis";
import { resolveCanvasUpstreamAuthorization } from "@/lib/gateway/upstream-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const clientKey = `login:${requestAddress(request)}`;
    try {
        enforceSameOrigin(request);
        enforceRateLimit(clientKey);
        const body = await parseAuthBody(request);
        const credentials = { username: stringInput(body.username), password: stringInput(body.password), code: stringInput(body.code) || undefined };
        let user = await authenticateLocalUser(credentials);
        if (user && user.credits === 0 && process.env.CANVAS_LEGACY_AUTH_ENABLED === "true") {
            const legacy = await verifyTokaxisCredentials(credentials);
            if (legacy.status === "authenticated" && legacy.identity.username.trim().toLowerCase() === user.username.trim().toLowerCase()) {
                user = await claimExternalAccount({ ...legacy.identity, password: credentials.password });
            }
        }
        if (!user && process.env.CANVAS_LEGACY_AUTH_ENABLED === "true") {
            const legacy = await verifyTokaxisCredentials(credentials);
            if (legacy.status === "authenticated") {
                user = await claimExternalAccount({ ...legacy.identity, password: credentials.password });
            } else if (legacy.status === "two_factor_required") {
                throw new AuthError(legacy.message, 428, "two_factor_required");
            } else if (legacy.status === "blocked") {
                throw tokaxisAuthError(legacy);
            } else if (legacy.status === "unavailable") {
                throw new AuthError("旧账户迁移校验暂时不可用，请稍后重试", 503);
            }
        }
        if (!user) throw new AuthError("用户名或密码错误", 401);
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
