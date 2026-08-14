import { NextResponse } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { buildEpayPaymentForm, getEpayConfig } from "@/lib/auth/epay";
import { enforceSameOrigin, numberInput, parseAuthBody, requireAuthUser, stringInput } from "@/lib/auth/route-utils";
import { createPaymentOrder } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(request: Request) {
    const configured = process.env.CANVAS_PUBLIC_ORIGIN?.trim();
    return configured ? new URL(configured).origin : new URL(request.url).origin;
}

export async function POST(request: Request) {
    try {
        enforceSameOrigin(request);
        const user = await requireAuthUser();
        const body = await parseAuthBody(request);
        const config = getEpayConfig();
        const amountYuan = Math.floor(numberInput(body.amountYuan));
        const paymentMethod = stringInput(body.paymentMethod).trim();
        const paymentPackage = config.packages.find((entry) => entry.amountYuan === amountYuan);
        if (!paymentPackage) throw new Error("invalid package");
        if (!config.methods.some((entry) => entry.type === paymentMethod)) throw new Error("invalid payment method");

        const created = createPaymentOrder({ userId: user.id, amountYuan: paymentPackage.amountYuan, credits: paymentPackage.credits, paymentMethod });
        const origin = publicOrigin(request);
        const form = buildEpayPaymentForm(
            {
                orderNo: created.orderNo,
                amountCents: created.amountCents,
                paymentMethod,
                notifyUrl: `${origin}/api/account/payments/epay/notify`,
                returnUrl: `${origin}/api/account/payments/epay/return`,
            },
            config,
        );
        return NextResponse.json({ order: created.order, form, checkoutUrl: `/api/account/payments/orders/${encodeURIComponent(created.order.id)}/checkout` }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        if (error instanceof Error && (error.message === "invalid package" || error.message === "invalid payment method")) {
            return NextResponse.json({ message: "支付参数不正确", code: "invalid_payment_request" }, { status: 400 });
        }
        return authErrorResponse(error);
    }
}
