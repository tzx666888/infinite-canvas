import { NextResponse } from "next/server";

import { getEpayConfig, parseEpayMoneyCents, verifyEpayParams } from "@/lib/auth/epay";
import { completePaymentOrder } from "@/lib/auth/store";

export async function collectEpayParams(request: Request) {
    const result: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams.entries()) result[key] = value;
    if (request.method === "POST") {
        const form = await request.formData();
        for (const [key, value] of form.entries()) if (typeof value === "string") result[key] = value;
    }
    return result;
}

export function settleEpayPayment(params: Record<string, string>) {
    const config = getEpayConfig();
    if (!verifyEpayParams(params, config)) return { status: "invalid" as const };
    if (params.trade_status !== "TRADE_SUCCESS") return { status: "pending" as const };
    const amountCents = parseEpayMoneyCents(params.money || "");
    const orderNo = params.out_trade_no?.trim();
    if (!amountCents || !orderNo) return { status: "invalid" as const };
    const result = completePaymentOrder({ orderNo, amountCents, providerTradeNo: params.trade_no });
    return { status: "paid" as const, order: result.order };
}

export function paymentTextResponse(success: boolean) {
    return new NextResponse(success ? "success" : "fail", {
        status: success ? 200 : 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
}
