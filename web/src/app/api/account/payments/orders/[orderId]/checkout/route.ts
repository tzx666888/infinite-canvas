import { authErrorResponse } from "@/lib/auth/auth-error";
import { buildEpayPaymentForm, getEpayConfig } from "@/lib/auth/epay";
import { requireAuthUser } from "@/lib/auth/route-utils";
import { getPaymentCheckoutForUser } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(request: Request) {
    const configured = process.env.CANVAS_PUBLIC_ORIGIN?.trim();
    return configured ? new URL(configured).origin : new URL(request.url).origin;
}

function escapeAttribute(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
    try {
        const user = await requireAuthUser();
        const { orderId } = await context.params;
        const checkout = getPaymentCheckoutForUser(user.id, orderId);
        const origin = publicOrigin(request);
        const form = buildEpayPaymentForm(
            {
                orderNo: checkout.orderNo,
                amountCents: checkout.amountCents,
                paymentMethod: checkout.paymentMethod,
                notifyUrl: `${origin}/api/account/payments/epay/notify`,
                returnUrl: `${origin}/api/account/payments/epay/return`,
            },
            getEpayConfig(),
        );
        const fields = Object.entries(form.fields)
            .map(([name, value]) => `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">`)
            .join("");
        const paymentOrigin = new URL(form.action).origin;
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在前往支付</title><style>html,body{margin:0;min-height:100%;background:#fff;color:#444;font:14px system-ui,sans-serif}body{display:grid;place-items:center;min-height:100vh}.status{padding:24px;text-align:center}</style></head><body><div class="status">正在连接安全支付页面，请稍候...</div><form id="payment-form" method="post" action="${escapeAttribute(form.action)}">${fields}</form><script>document.getElementById("payment-form").submit();</script></body></html>`;
        return new Response(html, {
            headers: {
                "Cache-Control": "no-store",
                "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action ${paymentOrigin}; base-uri 'none'; frame-ancestors 'none'`,
                "Content-Type": "text/html; charset=utf-8",
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        return authErrorResponse(error);
    }
}
