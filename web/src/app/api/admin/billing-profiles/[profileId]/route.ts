import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, parseAuthBody, requireAdminUser, stringInput } from "@/lib/auth/route-utils";
import { updateBillingProfile } from "@/lib/auth/store";
import { publicModelPrices } from "@/lib/gateway/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ profileId: string }> }) {
    try {
        enforceSameOrigin(request);
        const actor = await requireAdminUser();
        const body = await parseAuthBody(request);
        const { profileId } = await context.params;
        const rules = Array.isArray(body.rules)
            ? body.rules.map((item) => ({
                  model: item && typeof item === "object" ? stringInput((item as Record<string, unknown>).model) : "",
                  creditsPerUnit: item && typeof item === "object" ? Number((item as Record<string, unknown>).creditsPerUnit) : Number.NaN,
              }))
            : undefined;
        const profile = updateBillingProfile({
            actorUserId: actor.id,
            profileId,
            name: body.name === undefined ? undefined : stringInput(body.name),
            active: typeof body.active === "boolean" ? body.active : undefined,
            rules,
            basePrices: publicModelPrices(),
        });
        return NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
