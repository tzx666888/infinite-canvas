import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_DATA_DIR = await mkdtemp(path.join(tmpdir(), "canvas-payment-regression-"));
process.env.CANVAS_EPAY_ADDRESS = "https://payment.example.test/gateway";
process.env.CANVAS_EPAY_PARTNER_ID = "1001";
process.env.CANVAS_EPAY_KEY = "payment-regression-key";
process.env.CANVAS_EPAY_METHODS = JSON.stringify([
    { type: "alipay", name: "支付宝" },
    { type: "wxpay", name: "微信" },
]);
process.env.CANVAS_EPAY_AMOUNT_OPTIONS = JSON.stringify([1, 100]);
process.env.CANVAS_CREDITS_PER_YUAN = "10";

const { canvasDatabase } = await import("../src/lib/auth/database.ts");
const { buildEpayPaymentForm, getEpayConfig, signEpayParams, verifyEpayParams } = await import("../src/lib/auth/epay.ts");
const { completePaymentOrder, createPaymentOrder, getManagedUserDetails, getPaymentOrderForUser, walletSummary } = await import("../src/lib/auth/store.ts");

const database = canvasDatabase();
const rootUserId = "payment-regression-root";
const userId = "payment-regression-user";
const timestamp = new Date().toISOString();
database.prepare("INSERT INTO accounts (id, username, display_name, role, provider, password_hash, credits, created_at, updated_at) VALUES (?, 'root', 'Root', 'root', 'local', '', 0, ?, ?)").run(rootUserId, timestamp, timestamp);
database
    .prepare("INSERT INTO accounts (id, username, display_name, role, provider, password_hash, credits, created_at, updated_at) VALUES (?, ?, ?, 'member', 'local', '', 0, ?, ?)")
    .run(userId, "payment-regression", "Payment Regression", timestamp, timestamp);

const config = getEpayConfig();
const order = createPaymentOrder({ userId, amountYuan: 1, credits: 10, paymentMethod: "alipay" });
const form = buildEpayPaymentForm(
    {
        orderNo: order.orderNo,
        amountCents: order.amountCents,
        paymentMethod: "alipay",
        notifyUrl: "https://canvas.example.test/api/account/payments/epay/notify",
        returnUrl: "https://canvas.example.test/api/account/payments/epay/return",
    },
    config,
);
assert.equal(form.action, "https://payment.example.test/gateway/submit.php");
assert.equal(form.fields.money, "1.00");
assert.equal(verifyEpayParams(form.fields, config), true);
assert.equal(verifyEpayParams({ ...form.fields, money: "2.00" }, config), false);

const callback = {
    pid: config.partnerId,
    type: "alipay",
    out_trade_no: order.orderNo,
    trade_no: "provider-trade-001",
    name: "视觉画布积分",
    money: "1.00",
    trade_status: "TRADE_SUCCESS",
    sign_type: "MD5",
    sign: "",
};
callback.sign = signEpayParams(callback, config.key);
assert.equal(verifyEpayParams(callback, config), true);
assert.equal(completePaymentOrder({ orderNo: callback.out_trade_no, amountCents: 100, providerTradeNo: callback.trade_no }).newlyPaid, true);
assert.equal(completePaymentOrder({ orderNo: callback.out_trade_no, amountCents: 100, providerTradeNo: callback.trade_no }).newlyPaid, false, "duplicate callback must not add credits twice");
assert.equal((await walletSummary(userId)).credits, 10);
assert.equal(getPaymentOrderForUser(userId, order.order.id).status, "paid");

const lateOrder = createPaymentOrder({ userId, amountYuan: 1, credits: 10, paymentMethod: "wxpay" });
database.prepare("UPDATE payment_orders SET status = 'expired' WHERE id = ?").run(lateOrder.order.id);
const lateCallback = { ...callback, type: "wxpay", out_trade_no: lateOrder.orderNo, trade_no: "provider-trade-002", sign: "" };
lateCallback.sign = signEpayParams(lateCallback, config.key);
assert.equal(completePaymentOrder({ orderNo: lateCallback.out_trade_no, amountCents: 100, providerTradeNo: lateCallback.trade_no }).newlyPaid, true, "a valid late callback must still credit the account");
assert.equal((await walletSummary(userId)).credits, 20);

database.prepare("UPDATE accounts SET credits = 17, updated_at = ? WHERE id = ?").run(new Date().toISOString(), userId);
database
    .prepare("INSERT INTO credit_ledger (id, user_id, type, amount, balance_after, request_id, model, units, remark, created_at) VALUES ('payment-regression-consume', ?, 'consume', -3, 17, 'payment-regression-request', 'gpt-image-2', 1, '测试消耗', ?)")
    .run(userId, new Date().toISOString());
const details = await getManagedUserDetails({ rootUserId, userId, pageSize: 20 });
assert.equal(details.stats.currentCredits, 17);
assert.equal(details.stats.paidRechargeAmountYuan, 2);
assert.equal(details.stats.paidRechargeCredits, 20);
assert.equal(details.stats.paidRechargeCount, 2);
assert.equal(details.stats.totalAddedCredits, 20);
assert.equal(details.stats.totalConsumedCredits, 3);
assert.equal(details.stats.totalDeductedCredits, 3);
assert.equal(details.stats.ledgerNetCredits, 17);
assert.equal(details.stats.historicalCarryoverCredits, 0);
assert.equal(details.ledger.total, 3);
assert.equal(details.paymentOrders.total, 2);

console.log("Canvas payment gateway regression checks passed.");
