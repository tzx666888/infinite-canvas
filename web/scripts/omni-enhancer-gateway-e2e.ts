import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server.js";

const authDirectory = await mkdtemp(join(tmpdir(), "canvas-omni-enhancer-gateway-"));
process.env.NODE_ENV = "test";
process.env.AUTH_DATA_DIR = authDirectory;
process.env.CANVAS_UPSTREAM_ORIGIN = "http://omni-enhancer-upstream.test";
process.env.CANVAS_UPSTREAM_API_KEY = "omni-enhancer-upstream-secret";
process.env.CANVAS_SESSION_SECRET = "omni-enhancer-session-secret-0123456789abcdef";
process.env.CANVAS_API_KEY_PEPPER = "omni-enhancer-key-pepper-0123456789abcdef";
process.env.CANVAS_BOOTSTRAP_ROOT_USERNAME = "root";
process.env.CANVAS_BOOTSTRAP_ROOT_PASSWORD = "OmniEnhancerRootPassword123!";
process.env.CANVAS_BOOTSTRAP_ROOT_CREDITS = "200";
process.env.CANVAS_BILLING_ENABLED = "true";
process.env.CANVAS_MODEL_PRICES_JSON = JSON.stringify({
    omni: { credits: 10, unit: "request" },
    omni_portrait: { credits: 10, unit: "request" },
    "omni-1080p": { credits: 25, unit: "request" },
    "omni-1080p-pro": { credits: 35, unit: "request" },
    "gpt-image-2": { credits: 2, unit: "image" },
});

const { POST } = await import("../src/app/api/gateway/[...path]/route.ts");
const { authenticateLocalUser, createCanvasApiKey, walletSummary } = await import("../src/lib/auth/store.ts");
const root = await authenticateLocalUser({ username: "root", password: "OmniEnhancerRootPassword123!" });
assert.ok(root);
const { key } = await createCanvasApiKey(root.id, "Omni enhancer E2E");

const upstreamRequests: Array<{ model: string; headers: Headers; body: unknown }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const contentType = request.headers.get("content-type") || "";
    let body: unknown = null;
    if (contentType.includes("multipart/form-data")) {
        const form = await request.clone().formData();
        body = Object.fromEntries(
            Array.from(form.entries())
                .filter(([name]) => name === "model")
                .map(([name, value]) => [name, String(value)]),
        );
    } else {
        body = await request
            .clone()
            .json()
            .catch(() => ({}));
    }
    const model = body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).model === "string" ? String((body as Record<string, unknown>).model) : "";
    upstreamRequests.push({ model, headers: request.headers, body });
    return new Response(JSON.stringify({ id: `task-${upstreamRequests.length}`, status: "pending" }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

function routeRequest(path: string, body: BodyInit, headers: HeadersInit) {
    return POST(new NextRequest(`http://canvas.test/api/gateway/${path}`, { method: "POST", body, headers: { Authorization: `Bearer ${key}`, ...headers } }), { params: Promise.resolve({ path: path.split("/") }) });
}

try {
    const before = (await walletSummary(root.id)).credits;
    const requestId = "omni-enhancer-e2e-request";
    const baseForm = new FormData();
    baseForm.set("model", "omni");
    baseForm.set("prompt", "A simple product test");
    baseForm.set("seconds", "10");
    const baseResponse = await routeRequest("v1/videos", baseForm, { "x-canvas-request-id": requestId, "x-canvas-billing-model": "omni-1080p" });
    assert.equal(baseResponse.status, 200, await baseResponse.text());
    assert.equal((await walletSummary(root.id)).credits, before - 25, "the base hop must reserve the public Omni 1080p price");
    assert.equal(upstreamRequests.at(-1)?.model, "omni");
    assert.equal(upstreamRequests.at(-1)?.headers.get("x-canvas-billing-model"), null, "billing metadata must not leak upstream");

    const enhancerResponse = await routeRequest("v1/videos", JSON.stringify({ model: "1080", video_url: "data:video/mp4;base64,AAAA", size: "9:16" }), { "Content-Type": "application/json", "x-canvas-request-id": requestId });
    assert.equal(enhancerResponse.status, 200, await enhancerResponse.text());
    assert.equal((await walletSummary(root.id)).credits, before - 25, "the private enhancement hop must not create a second customer charge");
    assert.equal(upstreamRequests.at(-1)?.model, "1080");

    const upstreamCountBeforeDuplicate = upstreamRequests.length;
    const duplicateEnhancer = await routeRequest("v1/videos", JSON.stringify({ model: "1080", video_url: "data:video/mp4;base64,AAAA", size: "9:16" }), { "Content-Type": "application/json", "x-canvas-request-id": requestId });
    assert.equal(duplicateEnhancer.status, 409, "a consumed grant must not make the private id freely callable");
    assert.equal(upstreamRequests.length, upstreamCountBeforeDuplicate, "the rejected duplicate must not cross upstream");

    const spoofedBilling = await routeRequest("v1/videos", JSON.stringify({ model: "omni", prompt: "billing isolation" }), { "Content-Type": "application/json", "x-canvas-request-id": "spoofed-billing-request", "x-canvas-billing-model": "gpt-image-2" });
    assert.equal(spoofedBilling.status, 200);
    assert.equal((await walletSummary(root.id)).credits, before - 35, "an unrelated billing override must be ignored");
    assert.equal(upstreamRequests.at(-1)?.headers.get("x-canvas-billing-model"), null);
} finally {
    globalThis.fetch = originalFetch;
}

console.log("Omni enhancement gateway E2E checks passed");
