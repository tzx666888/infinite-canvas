import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { requireRootUser } from "@/lib/auth/route-utils";
import { listManagedUsers } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const root = await requireRootUser();
        const query = new URL(request.url).searchParams.get("query") || "";
        const users = await listManagedUsers({ rootUserId: root.id, query });
        return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return authErrorResponse(error);
    }
}
