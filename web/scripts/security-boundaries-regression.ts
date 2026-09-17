import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server.js";

const isolated = await mkdtemp(join(tmpdir(), "canvas-security-regression-"));
Object.assign(process.env, {
    IMAGE_JOB_DIR: join(isolated, "images"), AUTH_DATA_DIR: isolated,
    CANVAS_SESSION_SECRET: "local-test-session-secret-0123456789abcdef", CANVAS_API_KEY_PEPPER: "local-test-pepper-0123456789abcdef",
    CANVAS_BOOTSTRAP_ROOT_USERNAME: "root", CANVAS_BOOTSTRAP_ROOT_PASSWORD: "LocalTestFixture123!",
    CANVAS_INVITE_INITIAL_CREDITS: "200", CANVAS_BILLING_ENABLED: "true",
    CANVAS_UPSTREAM_ORIGIN: "https://upstream.invalid", CANVAS_UPSTREAM_API_KEY: "local-test-only",
    CANVAS_MODEL_PRICES_JSON: JSON.stringify({ sd30: { credits: 60, unit: "request" } }),
});
const store = await import("../src/lib/auth/store.ts");
const admin = await store.authenticateLocalUser({ username: "root", password: "LocalTestFixture123!" });
const invite = await store.createInvite({ actorUserId: admin.id, maxUses: 2 });
const a = await store.registerWithInvite({ username: "test-a", password: "LocalTestFixture123!", inviteCode: invite.code });
const b = await store.registerWithInvite({ username: "test-b", password: "LocalTestFixture123!", inviteCode: invite.code });
const ka = (await store.createCanvasApiKey(a.id, "test-a")).key;
const kb = (await store.createCanvasApiKey(b.id, "test-b")).key;
const { GET, POST } = await import("../src/app/api/gateway/[...path]/route.ts");
let submissions = 0;
let queries = 0;
let release!: () => void;
const barrier = new Promise<void>(resolve => { release = resolve; });
globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { submissions++; await barrier; return Response.json({ id: "owned-task", status: "pending" }); }
    queries++;
    return Response.json({ id: "owned-task", status: "pending", prompt: "owner-private" });
};
const request = () => new NextRequest("https://canvas.test/api/gateway/v1/videos/generations", {
    method: "POST", headers: { Authorization: `Bearer ${ka}`, "Content-Type": "application/json", "x-canvas-request-id": "concurrent-fixture" },
    body: JSON.stringify({ model: "sd30", prompt: "local fixture", seconds: 30 }),
});
const before = (await store.getAuthUser(a.id))!.credits;
const context = { params: Promise.resolve({ path: ["v1", "videos", "generations"] }) };
const first = POST(request(), context);
const second = POST(request(), context);
await new Promise(resolve => setTimeout(resolve, 50));
release();
assert.deepEqual((await Promise.all([first, second])).map(r => r.status).sort(), [200, 409]);
assert.equal(submissions, 1);
assert.equal(before - (await store.getAuthUser(a.id))!.credits, 60);
assert.equal((await POST(request(), context)).status, 409);
assert.equal(submissions, 1);

for (const path of ["v1/videos/generations/owned-task", "v1/videos/owned-task", "v1/videos/owned-task/content", "v1/contents/generations/tasks/owned-task"]) {
    const query = (key: string) => GET(new NextRequest(`https://canvas.test/api/gateway/${path}`, { headers: { Authorization: `Bearer ${key}` } }), { params: Promise.resolve({ path: path.split("/") }) });
    const previousQueries = queries;
    assert.equal((await query(kb)).status, 404);
    assert.equal(queries, previousQueries, "deny before touching upstream");
    assert.equal((await query(ka)).status, 200);
}
assert.equal((await GET(new NextRequest("https://canvas.test/api/gateway/v1/videos", { headers: { Authorization: `Bearer ${kb}` } }), { params: Promise.resolve({ path: ["v1", "videos"] }) })).status, 404);
// Existing deployments' billing rows remain sufficient to recover owned tasks.
const { canvasDatabase } = await import("../src/lib/auth/database.ts");
canvasDatabase().prepare("DELETE FROM video_task_owners WHERE task_id = ?").run("owned-task");
const { requireVideoTaskOwner } = await import("../src/lib/gateway/task-ownership.ts");
requireVideoTaskOwner("v1/videos/owned-task/content", a.id);
assert.throws(() => requireVideoTaskOwner("v1/videos/owned-task/content", b.id));

const images = await import("../src/server/image-job-store.ts");
globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
});
const id = "image-owner-fixture-1234567890";
const input = { id, operation: "generations" as const, authorization: "Bearer local-test-only", contentType: "application/json", body: new TextEncoder().encode("{}").buffer, userId: a.id };
const submitted = images.submitImageJob(input);
const unauthorizedDuplicate = images.submitImageJob({ ...input, userId: b.id });
await assert.rejects(unauthorizedDuplicate);
await submitted;
assert.equal(await images.cancelImageJob(id, b.id), null);
assert.equal((await images.getImageJob(id, a.id))!.status, "running");
assert.equal(await images.getImageJob(id, b.id), null);
assert.equal((await images.cancelImageJob(id, a.id))!.status, "failed");

// A worker crash between persisted result and settlement must not strand credits.
const staleId = "image-stale-ledger-fixture-12345";
const staleRequest = `image:${a.id}:${staleId}`;
store.reserveCredits({ userId: a.id, apiKeyId: (await store.authenticateCanvasApiKey(`Bearer ${ka}`))!.keyId, requestId: staleRequest, model: "gpt-image-2", amount: 2, units: 1, unit: "image", upstreamPath: "v1/images/generations" });
globalThis.fetch = async () => Response.json({ data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }] });
await images.submitImageJob({ ...input, id: staleId, billingRequestId: staleRequest });
for (let i = 0; i < 100 && (await images.getImageJob(staleId, a.id))?.status === "running"; i++) await new Promise(resolve => setTimeout(resolve, 10));
assert.equal((await images.getImageJob(staleId, a.id))?.status, "succeeded");
canvasDatabase().prepare("UPDATE billing_transactions SET status = 'reserved', created_at = ? WHERE request_id = ?").run(new Date(Date.now() - 3_600_000).toISOString(), staleRequest);
const creditsBeforeReconcile = (await store.getAuthUser(a.id))!.credits;
await images.reconcileReservedImageJobs();
assert.equal(canvasDatabase().prepare("SELECT status FROM billing_transactions WHERE request_id = ?").get(staleRequest)?.status, "settled");
assert.equal((await store.getAuthUser(a.id))!.credits, creditsBeforeReconcile, "settlement must never double-charge");

const { acquireWorkSlot, readBoundedBody } = await import("../src/server/work-limits.ts");
const freeA = acquireWorkSlot("conversion", a.id);
assert.throws(() => acquireWorkSlot("conversion", a.id), /任务较多/);
const freeB = acquireWorkSlot("conversion", b.id);
assert.throws(() => acquireWorkSlot("conversion", "third-user"), /任务较多/);
freeA(); freeA(); freeB();
acquireWorkSlot("conversion", a.id)();
await assert.rejects(readBoundedBody(new Request("https://canvas.test", { method: "POST", body: "12345" }), 4), /内容过大/);
assert.equal((await readBoundedBody(new Request("https://canvas.test", { method: "POST", body: "1234" }), 4)).byteLength, 4);
console.log("Security boundaries passed: atomic billing, task ownership, owner cancellation, concurrency admission, bounded uploads (no production requests)");
