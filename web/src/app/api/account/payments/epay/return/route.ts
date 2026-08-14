import { NextResponse } from "next/server";

import { collectEpayParams, settleEpayPayment } from "../route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return handle(request);
}

export async function POST(request: Request) {
    return handle(request);
}

async function handle(request: Request) {
    const origin = process.env.CANVAS_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin;
    let payment = "pending";
    try {
        const result = settleEpayPayment(await collectEpayParams(request));
        payment = result.status === "paid" ? "success" : result.status === "invalid" ? "failed" : "pending";
    } catch {
        payment = "failed";
    }
    return NextResponse.redirect(new URL(`/account?payment=${payment}`, origin), { status: 303 });
}
