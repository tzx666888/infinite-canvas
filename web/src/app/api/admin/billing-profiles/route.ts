import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, parseAuthBody, requireAdminUser, stringInput } from "@/lib/auth/route-utils";
import { createBillingProfile, listBillingProfiles } from "@/lib/auth/store";
import { publicModelPrices } from "@/lib/gateway/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rulesInput(value: unknown) {
    return Array.isArray(value)
        ? value.map((item) => ({
              model: item && typeof item === "object" ? stringInput((item as Record<string, unknown>).model) : "",
              creditsPerUnit: item && typeof item === "object" ? Number((item as Record<string, unknown>).creditsPerUnit) : Number.NaN,
          }))
        : [];
}

export async function GET() {
    try {
        const actor = await requireAdminUser();
        const basePrices = publicModelPrices();
        return NextResponse.json({ profiles: listBillingProfiles({ actorUserId: actor.id, basePrices }), basePrices }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        enforceSameOrigin(request);
        const actor = await requireAdminUser();
        const body = await parseAuthBody(request);
        const basePrices = publicModelPrices();
        const profile = createBillingProfile({ actorUserId: actor.id, name: stringInput(body.name), rules: rulesInput(body.rules), basePrices });
        return NextResponse.json({ profile }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
