import { NextResponse } from "next/server";
import { AuthError, authErrorResponse } from "@/lib/auth/auth-error";
import { requireAuthUser } from "@/lib/auth/route-utils";
import { authenticateCanvasApiKeyReadOnly } from "@/lib/auth/store";
import { quoteGatewayVideo } from "@/lib/gateway/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const authorization = request.headers.get("authorization");
        let userId: string;
        if (authorization) {
            const identity = await authenticateCanvasApiKeyReadOnly(authorization.replace(/^Bearer\s+/i, ""));
            if (!identity) throw new AuthError("平台 Key 无效，请重新登录", 401);
            userId = identity.user.id;
        } else {
            userId = (await requireAuthUser()).id;
        }
        const params = new URL(request.url).searchParams;
        return NextResponse.json(quoteGatewayVideo(userId, params.get("model") || "", Number(params.get("seconds"))), { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
