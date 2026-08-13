import { NextResponse } from "next/server";

import { AuthError, authErrorResponse } from "@/lib/auth/auth-error";
import { enforceRateLimit, clearRateLimit, requestAddress } from "@/lib/auth/rate-limit";
import { enforceSameOrigin, parseAuthBody, stringInput } from "@/lib/auth/route-utils";
import { createSessionToken, AUTH_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { authenticateLocalUser, migrateLocalAccountToTokaxis, upsertTokaxisAccount } from "@/lib/auth/store";
import { registerTokaxisAccount, tokaxisAuthError, verifyTokaxisCredentials } from "@/lib/auth/tokaxis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const clientKey = `login:${requestAddress(request)}`;
    try {
        enforceSameOrigin(request);
        enforceRateLimit(clientKey);
        const body = await parseAuthBody(request);
        const credentials = { username: stringInput(body.username), password: stringInput(body.password), code: stringInput(body.code) || undefined };
        const tokaxis = await verifyTokaxisCredentials(credentials);
        let user;
        if (tokaxis.status === "authenticated") {
            user = await upsertTokaxisAccount(tokaxis.identity);
        } else if (tokaxis.status === "two_factor_required") {
            throw new AuthError(tokaxis.message, 428, "two_factor_required");
        } else if (tokaxis.status === "blocked") {
            throw tokaxisAuthError(tokaxis);
        } else {
            user = await authenticateLocalUser(credentials);
            if (!user) {
                if (tokaxis.status === "unavailable") throw new AuthError("中转站账号校验服务暂时不可用，请稍后重试", 503);
                throw new AuthError("用户名或密码错误", 401);
            }
            if (tokaxis.status === "invalid") {
                const identity = await registerTokaxisAccount(credentials);
                user = await migrateLocalAccountToTokaxis({ localUserId: user.id, identity });
            }
        }
        clearRateLimit(clientKey);
        const response = NextResponse.json({ user });
        response.cookies.set(AUTH_COOKIE_NAME, createSessionToken(user.id), sessionCookieOptions());
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch (error) {
        return authErrorResponse(error);
    }
}
