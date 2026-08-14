import { collectEpayParams, paymentTextResponse, settleEpayPayment } from "../route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return handle(request);
}

export async function POST(request: Request) {
    return handle(request);
}

async function handle(request: Request) {
    try {
        const result = settleEpayPayment(await collectEpayParams(request));
        return paymentTextResponse(result.status !== "invalid");
    } catch {
        return paymentTextResponse(false);
    }
}
