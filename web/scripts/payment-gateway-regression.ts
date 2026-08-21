import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

const authDataDirectory = await mkdtemp(path.join(tmpdir(), "canvas-payment-regression-"));
process.env.AUTH_DATA_DIR = authDataDirectory;
process.env.CANVAS_EPAY_ADDRESS = "https://payment.example.test/gateway";
process.env.CANVAS_EPAY_PARTNER_ID = "1001";
process.env.CANVAS_EPAY_KEY = "payment-regression-key";
process.env.CANVAS_EPAY_METHODS = JSON.stringify([
    { type: "alipay", name: "支付宝" },
    { type: "wxpay", name: "微信" },
]);
process.env.CANVAS_EPAY_AMOUNT_OPTIONS = JSON.stringify([1, 100]);
process.env.CANVAS_CREDITS_PER_YUAN = "10";

// Production already has this table. Recreate the pre-v3.128.0 shape so the
// regression also proves that the additive realm migration is startup-safe.
const legacyDatabase = new BetterSqlite3(path.join(authDataDirectory, "canvas.sqlite"));
legacyDatabase.exec(`
    CREATE TABLE payment_orders (
        id TEXT PRIMARY KEY,
        order_no TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        credits INTEGER NOT NULL CHECK (credits > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired')),
        provider_trade_no TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`);
legacyDatabase.close();

const { canvasDatabase } = await import("../src/lib/auth/database.ts");
const { CANVAS_PAYMENT_PRODUCT_NAME, buildEpayPaymentForm, getEpayConfig, signEpayParams, verifyEpayParams } = await import("../src/lib/auth/epay.ts");
const { completePaymentOrder, createPaymentOrder, getManagedUserDetails, getPaymentOrderForUser, isCanvasPaymentOrderNo, walletSummary } = await import("../src/lib/auth/store.ts");

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
assert.equal(isCanvasPaymentOrderNo(order.orderNo), true);
assert.equal(database.prepare("SELECT payment_realm FROM payment_orders WHERE id = ?").get(order.order.id)?.payment_realm, "canvas");
assert.throws(
    () => database.prepare("INSERT INTO payment_orders (id, order_no, payment_realm, user_id, payment_method, amount_cents, credits, status, created_at, expires_at, updated_at) VALUES ('foreign-order', 'NAPI123', 'newapi', ?, 'alipay', 100, 10, 'pending', ?, ?, ?)").run(userId, timestamp, timestamp, timestamp),
    /Canvas payment realm only|CHECK constraint failed/,
    "Canvas 数据库不得接收中转站充值域",
);
assert.throws(
    () => completePaymentOrder({ orderNo: "NAPI123", amountCents: 100, providerTradeNo: "foreign-trade" }),
    /充值订单不存在/,
    "中转站订单号不得进入画布结算",
);
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
assert.equal(form.fields.name, CANVAS_PAYMENT_PRODUCT_NAME);
assert.equal(verifyEpayParams(form.fields, config), true);
assert.equal(verifyEpayParams({ ...form.fields, money: "2.00" }, config), false);

const callback = {
    pid: config.partnerId,
    type: "alipay",
    out_trade_no: order.orderNo,
    trade_no: "provider-trade-001",
    name: CANVAS_PAYMENT_PRODUCT_NAME,
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
