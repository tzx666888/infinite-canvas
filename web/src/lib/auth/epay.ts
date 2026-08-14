import { createHash, timingSafeEqual } from "node:crypto";

import { AuthError } from "./auth-error.ts";
import type { PaymentMethod, PaymentPackage } from "./types.ts";

type EpayConfig = {
    address: string;
    partnerId: string;
    key: string;
    methods: PaymentMethod[];
    packages: PaymentPackage[];
};

export type EpayPaymentForm = {
    action: string;
    fields: Record<string, string>;
};

function configuredValue(name: string) {
    return process.env[name]?.trim() || "";
}

function parseMethods(raw: string): PaymentMethod[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const value = entry as Record<string, unknown>;
            const type = typeof value.type === "string" ? value.type.trim() : "";
            const name = typeof value.name === "string" ? value.name.trim() : "";
            return type && name && /^[a-z0-9_-]{1,32}$/i.test(type) ? [{ type, name: name.slice(0, 32) }] : [];
        });
    } catch {
        return [];
    }
}

function parseAmountOptions(raw: string, creditsPerYuan: number): PaymentPackage[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        const values = new Set<number>();
        for (const entry of parsed) {
            const amount = Number(entry);
            if (Number.isInteger(amount) && amount >= 1 && amount <= 100_000) values.add(amount);
        }
        return [...values].sort((left, right) => left - right).map((amountYuan) => ({ amountYuan, credits: amountYuan * creditsPerYuan }));
    } catch {
        return [];
    }
}

function configuredCreditsPerYuan() {
    const value = Number(configuredValue("CANVAS_CREDITS_PER_YUAN") || "10");
    return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : 10;
}

export function getEpayConfig(): EpayConfig {
    const address = configuredValue("CANVAS_EPAY_ADDRESS");
    const partnerId = configuredValue("CANVAS_EPAY_PARTNER_ID");
    const key = configuredValue("CANVAS_EPAY_KEY");
    if (!address || !partnerId || !key) throw new AuthError("在线支付暂未开放，请联系管理员", 503, "payment_unavailable");

    let parsedAddress: URL;
    try {
        parsedAddress = new URL(address);
    } catch {
        throw new AuthError("在线支付暂未开放，请联系管理员", 503, "payment_unavailable");
    }
    if (parsedAddress.protocol !== "https:" && parsedAddress.protocol !== "http:") throw new AuthError("在线支付暂未开放，请联系管理员", 503, "payment_unavailable");

    const methods = parseMethods(configuredValue("CANVAS_EPAY_METHODS"));
    const packages = parseAmountOptions(configuredValue("CANVAS_EPAY_AMOUNT_OPTIONS"), configuredCreditsPerYuan());
    if (!methods.length || !packages.length) throw new AuthError("在线支付暂未开放，请联系管理员", 503, "payment_unavailable");

    return { address: parsedAddress.toString(), partnerId, key, methods, packages };
}

export function publicEpayConfig() {
    const config = getEpayConfig();
    return { enabled: true, methods: config.methods, packages: config.packages };
}

function signaturePayload(params: Record<string, string>) {
    return Object.entries(params)
        .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
}

export function signEpayParams(params: Record<string, string>, key: string) {
    return createHash("md5")
        .update(`${signaturePayload(params)}${key}`)
        .digest("hex");
}

export function verifyEpayParams(params: Record<string, string>, config = getEpayConfig()) {
    if (params.pid !== config.partnerId || !params.sign) return false;
    const expected = signEpayParams(params, config.key);
    const supplied = params.sign.toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(supplied)) return false;
    return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

function paymentAction(address: string) {
    const action = new URL(address);
    action.pathname = `${action.pathname.replace(/\/+$/, "")}/submit.php`.replace(/^submit\.php$/, "/submit.php");
    action.search = "";
    action.hash = "";
    return action.toString();
}

export function buildEpayPaymentForm(input: { orderNo: string; amountCents: number; paymentMethod: string; notifyUrl: string; returnUrl: string }, config = getEpayConfig()): EpayPaymentForm {
    if (!config.methods.some((method) => method.type === input.paymentMethod)) throw new AuthError("支付方式暂不可用", 400, "payment_method_unavailable");
    const fields: Record<string, string> = {
        pid: config.partnerId,
        type: input.paymentMethod,
        out_trade_no: input.orderNo,
        notify_url: input.notifyUrl,
        return_url: input.returnUrl,
        name: "视觉画布积分",
        money: (input.amountCents / 100).toFixed(2),
        device: "pc",
        sign_type: "MD5",
        sign: "",
    };
    fields.sign = signEpayParams(fields, config.key);
    return { action: paymentAction(config.address), fields };
}

export function parseEpayMoneyCents(value: string) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
