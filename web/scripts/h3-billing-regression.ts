import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { billingQuoteLabel, configuredH3Rate } from "../src/lib/h3-billing.ts";

process.env.AUTH_DATA_DIR = await mkdtemp(join(tmpdir(), "canvas-h3-billing-"));
process.env.CANVAS_API_KEY_PEPPER = "test-h3-key-pepper-0123456789abcdef";
process.env.CANVAS_BOOTSTRAP_ROOT_USERNAME = "root";
process.env.CANVAS_BOOTSTRAP_ROOT_PASSWORD = "H3BillingTestPassword123!";
process.env.CANVAS_BOOTSTRAP_ROOT_CREDITS = "10000";
process.env.CANVAS_BILLING_ENABLED = "true";
const h3 = { "MiniMaxH3-720p": 2.5, "MiniMaxH3-2k": 3, "minimax-h3-720p": 2.5, "minimax-h3-1080p": 3.5, "minimax-h3-1080p-pro": 4.5 };
process.env.CANVAS_MODEL_PRICES_JSON = JSON.stringify({
    ...Object.fromEntries(Object.entries(h3).map(([model, credits]) => [model, { credits, unit: "second" }])),
    omni: { credits: 10, unit: "request" }, sd30: { credits: 60, unit: "request" },
    "doubao-seedance-2-0-mini-260615": { credits: 11, unit: "request", creditsBySeconds: { "10": 22, "15": 33 } },
});
const billing = await import("../src/lib/gateway/billing.ts");
const store = await import("../src/lib/auth/store.ts");
const { canvasDatabase } = await import("../src/lib/auth/database.ts");
const user = await store.authenticateLocalUser({ username: "root", password: "H3BillingTestPassword123!" });
const { apiKey } = await store.createCanvasApiKey(user.id, "H3 non-billable test");
const identity = { userId: user.id, keyId: apiKey.id };
const request = (model: string, seconds: unknown, extra: Record<string, unknown> = {}) => new Request("http://local.test/v1/videos/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, seconds, ...extra }) });
const before = (await store.walletSummary(user.id)).credits;
for (const [model, rate] of Object.entries(h3)) {
    for (const seconds of [4, 5, 7, 10, 12, 15]) {
        const quote = billing.quoteGatewayVideo(user.id, model, seconds);
        assert.equal(quote.unit, "second");
        assert.equal(quote.amount, rate * seconds);
        assert.equal(billingQuoteLabel(quote), `${rate} 积分/秒 × ${seconds} 秒 = ${rate * seconds} 积分`);
        assert.equal((await store.walletSummary(user.id)).credits, before, "quoting is read-only");
        const reservation = await billing.reserveGatewayRequest(request(model, seconds), "v1/videos/generations", identity, `${model}-${seconds}`);
        assert.equal(reservation?.amount, quote.amount);
        const tx = canvasDatabase().prepare("SELECT unit, units, retail_rate FROM billing_transactions WHERE request_id=?").get(reservation!.requestId);
        assert.equal(tx?.unit, "second"); assert.equal(tx?.units, seconds); assert.equal(tx?.retail_rate, rate);
        await assert.rejects(billing.reserveGatewayRequest(request(model, seconds), "v1/videos/generations", identity, reservation!.requestId));
        await billing.finalizeGatewayResponse(new Response("rejected", { status: 400 }), reservation);
        billing.refundGatewayReservation(reservation!);
        assert.equal((await store.walletSummary(user.id)).credits, before, "failure refunds only once");
    }
}
for (const seconds of [0, -1, 1, 3, 14.5, 20, "bad"]) await assert.rejects(billing.reserveGatewayRequest(request("MiniMaxH3-720p", seconds), "v1/videos/generations", identity));
await assert.rejects(billing.reserveGatewayRequest(request("MiniMaxH3-720p", 10, { duration: 15 }), "v1/videos/generations", identity));
const form = new FormData(); form.set("model", "MiniMaxH3-720p"); form.set("duration", "15");
const multipart = await billing.reserveGatewayRequest(new Request("http://local.test", { method: "POST", body: form }), "v1/videos", identity);
assert.equal(multipart?.amount, 37.5); billing.refundGatewayReservation(multipart!);
for (const [model, amount] of [["omni", 10], ["sd30", 60], ["doubao-seedance-2-0-mini-260615", 33]] as const) {
    const reservation = await billing.reserveGatewayRequest(request(model, 15), "v1/videos/generations", identity);
    assert.equal(reservation?.amount, amount); billing.refundGatewayReservation(reservation!);
}
assert.equal(configuredH3Rate("minimax-h3-1080p", 25.5, "request", "second"), 2.55);
assert.equal(configuredH3Rate("MiniMaxH3-720p", 3.5, "second", "second"), 3.5);
assert.equal(configuredH3Rate("omni", 10, "request", "second"), 10);
assert.equal((await store.walletSummary(user.id)).credits, before);
const db = canvasDatabase();
db.prepare("INSERT INTO accounts (id,username,display_name,role,provider,credits,status,created_at,updated_at,is_distributor) VALUES ('h3-owner','h3-owner','H3 owner','member','local',0,'active','test','test',1)").run();
db.prepare("INSERT INTO billing_profiles (id,admin_user_id,name,active,created_at,updated_at) VALUES ('h3-profile','h3-owner','H3 test',1,'test','test')").run();
db.prepare("UPDATE accounts SET owner_admin_id='h3-owner', billing_profile_id='h3-profile' WHERE id=?").run(user.id);
db.prepare("INSERT INTO billing_price_rules (profile_id,model,credits_per_unit,unit) VALUES ('h3-profile','minimaxh3-720p',18.5,'request')").run();
const distributorQuote = billing.quoteGatewayVideo(user.id, "MiniMaxH3-720p", 15);
assert.equal(distributorQuote.rate, 1.85); assert.equal(distributorQuote.amount, 27.75);
const distributed = await billing.reserveGatewayRequest(request("MiniMaxH3-720p", 15), "v1/videos/generations", identity);
assert.equal(distributed?.amount, distributorQuote.amount);
billing.refundGatewayReservation(distributed!);
db.prepare("UPDATE billing_price_rules SET unit='second',credits_per_unit=3 WHERE profile_id='h3-profile'").run();
assert.equal(billing.quoteGatewayVideo(user.id, "MiniMaxH3-720p", 15).amount, 45);
assert.equal((await store.walletSummary(user.id)).credits, before);
console.log("H3 quote, exact deduction, duration, isolation, duplicate and refund checks passed (no upstream calls)");
