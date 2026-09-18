export const H3_MIN_SECONDS = 4;
export const H3_MAX_SECONDS = 15;

export function isH3BillingModel(model: string) {
    return /^(minimaxh3-(720p|2k)|minimax-h3-(720p|1080p|1080p-pro|c4))$/.test(model.trim().toLowerCase().split("::").at(-1) || "");
}

export type BillingQuote = { model: string; unit: "request" | "image" | "second"; rate: number; units: number; amount: number };

// Retain existing distributor overrides when the platform switches H3 to seconds.
// New/edited profiles save the explicit second unit; old request rows remain rollback-safe.
export function configuredH3Rate(model: string, configuredRate: number, configuredUnit: string, billingUnit: string) {
    return isH3BillingModel(model) && configuredUnit === "request" && billingUnit === "second" ? Number((configuredRate / 10).toFixed(6)) : configuredRate;
}

export function billingQuoteLabel(quote: BillingQuote) {
    const format = (value: number) => Number(value.toFixed(6)).toString();
    return quote.unit === "second"
        ? `${format(quote.rate)} 积分/秒 × ${format(quote.units)} 秒 = ${format(quote.amount)} 积分`
        : `${format(quote.amount)} 积分/次`;
}
