import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const authDirectory = await mkdtemp(path.join(tmpdir(), "canvas-payment-e2e-auth-"));
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, [path.join(root, ".next/standalone/server.js")], {
    cwd: root,
    env: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_DATA_DIR: authDirectory,
        CANVAS_PUBLIC_ORIGIN: origin,
        CANVAS_SESSION_SECRET: "payment-e2e-session-secret-0123456789abcdef",
        CANVAS_API_KEY_PEPPER: "payment-e2e-api-key-pepper-0123456789abcdef",
        CANVAS_BOOTSTRAP_ROOT_USERNAME: "root",
        CANVAS_BOOTSTRAP_ROOT_PASSWORD: "PaymentRootPassword123!",
        CANVAS_EPAY_ADDRESS: "https://payment.example.test/gateway",
        CANVAS_EPAY_PARTNER_ID: "1001",
        CANVAS_EPAY_KEY: "payment-regression-key",
        CANVAS_EPAY_METHODS: JSON.stringify([
            { type: "alipay", name: "支付宝" },
            { type: "wxpay", name: "微信" },
        ]),
        CANVAS_EPAY_AMOUNT_OPTIONS: JSON.stringify([1, 100]),
        CANVAS_CREDITS_PER_YUAN: "10",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
});

try {
    await waitForServer(`${origin}/api/health`);
    const login = await requestJson(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ username: "root", password: "PaymentRootPassword123!" }),
    });
    assert.equal(login.response.status, 200, JSON.stringify(login.body));
    const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "login must issue a session cookie");

    const config = await requestJson(`${origin}/api/account/payments/config`, { headers: { Cookie: cookie } });
    assert.equal(config.response.status, 200, JSON.stringify(config.body));
    assert.deepEqual(
        config.body.methods.map((method) => method.type),
        ["alipay", "wxpay"],
    );
    assert.deepEqual(
        config.body.packages.map((item) => item.amountYuan),
        [1, 100],
    );

    const created = await requestJson(`${origin}/api/account/payments/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ amountYuan: 1, paymentMethod: "alipay" }),
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.form.action, "https://payment.example.test/gateway/submit.php");
    assert.equal(created.body.form.fields.money, "1.00");

    const { signEpayParams } = await import("../src/lib/auth/epay.ts");
    const callback = {
        ...created.body.form.fields,
        trade_no: "provider-trade-e2e",
        trade_status: "TRADE_SUCCESS",
        sign: "",
    };
    callback.sign = signEpayParams(callback, "payment-regression-key");
    const notify = await requestJson(`${origin}/api/account/payments/epay/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(callback),
    });
    assert.equal(notify.response.status, 200);
    assert.equal(notify.text, "success");

    const order = await requestJson(`${origin}/api/account/payments/orders/${created.body.order.id}`, { headers: { Cookie: cookie } });
    assert.equal(order.body.order.status, "paid");
    assert.equal(order.body.order.credits, 10);
    const wallet = await requestJson(`${origin}/api/account/wallet`, { headers: { Cookie: cookie } });
    assert.equal(wallet.body.credits, 10);

    const duplicate = await requestJson(`${origin}/api/account/payments/epay/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(callback),
    });
    assert.equal(duplicate.text, "success");
    const walletAfterDuplicate = await requestJson(`${origin}/api/account/wallet`, { headers: { Cookie: cookie } });
    assert.equal(walletAfterDuplicate.body.credits, 10, "duplicate notify must not add credits twice");
    console.log("Canvas payment gateway HTTP e2e checks passed.");
} finally {
    app.kill("SIGTERM");
}

async function requestJson(url, init) {
    const response = await fetch(url, init);
    const text = await response.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        // Payment callbacks intentionally return plain text.
    }
    return { response, body, text };
}

async function waitForServer(url) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // The production server is still starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("local Next server did not start");
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("no free port"));
            server.close(() => resolve(address.port));
        });
    });
}
