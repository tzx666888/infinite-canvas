"use client";

import { useEffect, useState } from "react";
import { billingQuoteLabel, type BillingQuote } from "@/lib/h3-billing";
import { fetchVideoQuote } from "@/services/api/auth";

export function H3BillingQuote({ model, seconds, apiKey, platform }: { model: string; seconds: number; apiKey: string; platform: boolean }) {
    const [result, setResult] = useState<{ input: string; quote?: BillingQuote; error?: string } | null>(null);
    const input = JSON.stringify([model, seconds, apiKey, platform]);
    useEffect(() => {
        if (!platform) return;
        const controller = new AbortController();
        fetchVideoQuote(model, seconds, apiKey, controller.signal)
            .then((quote) => setResult({ input, quote }))
            .catch((error) => { if (!controller.signal.aborted) setResult({ input, error: error instanceof Error ? error.message : "报价暂不可用" }); });
        return () => controller.abort();
    }, [input, model, seconds, apiKey, platform]);
    if (!platform) return <div className="text-xs leading-5 opacity-70">自定义渠道：费用以该渠道账单为准。</div>;
    const current = result?.input === input ? result : null;
    return <div className="text-xs leading-5" aria-live="polite" data-testid="h3-billing-quote">
        {current?.quote ? <><div className="font-medium">{current.quote.unit === "second" ? "按秒计费" : "按次计费"}</div><div>{billingQuoteLabel(current.quote)}</div><div className="opacity-60">按本次所选时长预扣，生成失败自动退回；以提交时报价为准。</div></> : <div className="opacity-70">{current?.error || "正在获取本账号价格…"}</div>}
    </div>;
}
