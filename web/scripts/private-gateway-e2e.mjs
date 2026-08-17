import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const testDirectory = await mkdtemp(path.join(tmpdir(), "canvas-private-gateway-"));
const authDirectory = path.join(testDirectory, "auth");
const requests = [];
let videoTaskStatus = "pending";
let compatibilityVideoTaskStatus = "pending";

const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = parseJson(bodyText);
    requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        canvasUserId: request.headers["x-canvas-user-id"],
        canvasUsername: request.headers["x-canvas-username"],
        canvasRequestId: request.headers["x-canvas-request-id"],
        canvasAttribution: request.headers["x-canvas-attribution"],
        body,
    });
    response.setHeader("Content-Type", "application/json");

    if (request.method === "GET" && request.url === "/v1/models") {
        response.end(JSON.stringify({ data: [{ id: "gpt-5.6-sol" }, { id: "gpt-image-2" }, { id: "Seedance 2.0-fast-720p" }, { id: "unpriced-upstream-model" }] }));
        return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
        if (bodyText.includes("trigger-moderation")) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: { message: "Flow2API imagine:content-moderated at https://secret-provider.invalid/task" } }));
            return;
        }
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "站内 Agent 已连通" } }] }));
        return;
    }
    if (request.method === "POST" && request.url === "/v1/responses") {
        response.end(JSON.stringify({ id: `response-${requests.length}`, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Agent 回合已完成" }] }] }));
        return;
    }
    if (request.method === "POST" && request.url === "/v1/images/generations") {
        response.end(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] }));
        return;
    }
    if (request.method === "POST" && request.url === "/v1/videos/generations") {
        videoTaskStatus = "pending";
        response.end(JSON.stringify({ id: "task_private_gateway_video", status: videoTaskStatus }));
        return;
    }
    if (request.method === "GET" && request.url === "/v1/videos/generations/task_private_gateway_video") {
        videoTaskStatus = "completed";
        response.end(JSON.stringify({ id: "task_private_gateway_video", status: videoTaskStatus, output: { url: "https://media.invalid/result.mp4" } }));
        return;
    }
    if (request.method === "POST" && request.url === "/v1/contents/generations/tasks") {
        compatibilityVideoTaskStatus = "pending";
        response.end(JSON.stringify({ id: "task_compatibility_video", status: compatibilityVideoTaskStatus }));
        return;
    }
    if (request.method === "GET" && request.url === "/v1/contents/generations/tasks/task_compatibility_video") {
        compatibilityVideoTaskStatus = "failed";
        response.end(JSON.stringify({ id: "task_compatibility_video", status: compatibilityVideoTaskStatus, error: { message: "generation failed" } }));
        return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "mock route missing" } }));
});

let app;
try {
    await mkdir(authDirectory, { recursive: true });
    const upstreamPort = await listen(upstream);
    const appPort = await freePort();
    const origin = `http://127.0.0.1:${appPort}`;
    app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(appPort)], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
            ...process.env,
            NODE_ENV: "production",
            AUTH_DATA_DIR: authDirectory,
            IMAGE_JOB_DIR: path.join(testDirectory, "image-jobs"),
            CANVAS_PUBLIC_ORIGIN: origin,
            CANVAS_UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
            CANVAS_UPSTREAM_API_KEY: "upstream-service-secret",
            TOKAXIS_INTERNAL_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
            CANVAS_AUTH_SHARED_SECRET: "legacy-auth-shared-secret-0123456789abcdef",
            CANVAS_SESSION_SECRET: "session-secret-for-private-gateway-e2e-0123456789abcdef",
            CANVAS_API_KEY_PEPPER: "api-key-pepper-for-private-gateway-e2e-0123456789abcdef",
            CANVAS_BOOTSTRAP_ROOT_USERNAME: "root",
            CANVAS_BOOTSTRAP_ROOT_PASSWORD: "LocalRootPassword123!",
            CANVAS_BOOTSTRAP_ROOT_CREDITS: "100",
            CANVAS_INVITE_INITIAL_CREDITS: "20",
            CANVAS_BILLING_ENABLED: "true",
            CANVAS_MODEL_PRICES_JSON: JSON.stringify({
                "gpt-5.6-sol": { credits: 1, unit: "request" },
                "gpt-image-2": { credits: 2, unit: "image" },
                "seedance 2.0-fast-720p": { credits: 0.5, unit: "second" },
            }),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let appOutput = "";
    app.stdout.on("data", (chunk) => (appOutput += chunk));
    app.stderr.on("data", (chunk) => (appOutput += chunk));
    await waitForServer(`${origin}/api/health`, app, () => appOutput);

    const login = await requestJson(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ username: "root", password: "LocalRootPassword123!" }),
    });
    assert.equal(login.response.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.username, "root");
    assert.equal(login.body.user.credits, 100);
    const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("infinite_canvas_session="), "station login must issue an HTTP-only session cookie");

    const legacyLogin = await requestJson(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ username: "legacy-user", password: "oldpass" }),
    });
    assert.equal(legacyLogin.response.status, 401, "old station credentials must not enter the Canvas after the migration bridge is removed");

    const invite = await requestJson(`${origin}/api/admin/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ label: "E2E Invite", maxUses: 1, expiresInDays: 7 }),
    });
    assert.equal(invite.response.status, 200, JSON.stringify(invite.body));
    assert.match(invite.body.code, /^VC-/);
    const registered = await requestJson(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ username: "invited-user", password: "InvitedPassword123!", inviteCode: invite.body.code }),
    });
    assert.equal(registered.response.status, 200, JSON.stringify(registered.body));
    assert.equal(registered.body.user.credits, 20);
    const memberCookie = registered.response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(memberCookie, "registration must issue a member session cookie");

    const memberUserList = await requestJson(`${origin}/api/admin/users`, { headers: { Cookie: memberCookie } });
    assert.equal(memberUserList.response.status, 403, "ordinary users must never access user management");
    const rootUserList = await requestJson(`${origin}/api/admin/users`, { headers: { Cookie: cookie } });
    assert.equal(rootUserList.response.status, 200, JSON.stringify(rootUserList.body));
    const managedMember = rootUserList.body.users.find((item) => item.username === "invited-user");
    assert.ok(managedMember, "root must see registered users");
    assert.equal(managedMember.activeKeyCount, 0, "users without keys must report zero active keys");

    const memberKeyResult = await requestJson(`${origin}/api/account/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: memberCookie },
        body: JSON.stringify({ name: "Managed Member Key" }),
    });
    assert.equal(memberKeyResult.response.status, 201, JSON.stringify(memberKeyResult.body));
    const revokeMemberKeys = await requestJson(`${origin}/api/admin/users/${managedMember.id}/keys`, {
        method: "DELETE",
        headers: { Origin: origin, Cookie: cookie },
    });
    assert.equal(revokeMemberKeys.response.status, 200, JSON.stringify(revokeMemberKeys.body));
    assert.equal(revokeMemberKeys.body.revokedCount, 1);
    const revokedMemberKeyModels = await requestJson(`${origin}/api/gateway/v1/models`, { headers: { Authorization: `Bearer ${memberKeyResult.body.key}` } });
    assert.equal(revokedMemberKeyModels.response.status, 401, "root must be able to revoke a user's active Canvas keys");
    const userListAfterKeyRevocation = await requestJson(`${origin}/api/admin/users`, { headers: { Cookie: cookie } });
    assert.equal(userListAfterKeyRevocation.body.users.find((item) => item.username === "invited-user")?.activeKeyCount, 0, "revoked keys must disappear from the active-key count");

    const promoteMember = await requestJson(`${origin}/api/admin/users/${managedMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ displayName: "Managed Member", role: "root" }),
    });
    assert.equal(promoteMember.response.status, 200, JSON.stringify(promoteMember.body));
    const promotedUserList = await requestJson(`${origin}/api/admin/users`, { headers: { Cookie: memberCookie } });
    assert.equal(promotedUserList.response.status, 403, "only the canonical root account may modify users, even if another account has a root role");
    const restoreMemberRole = await requestJson(`${origin}/api/admin/users/${managedMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ role: "member", status: "disabled" }),
    });
    assert.equal(restoreMemberRole.response.status, 200, JSON.stringify(restoreMemberRole.body));
    const disabledMemberSession = await requestJson(`${origin}/api/auth/me`, { headers: { Cookie: memberCookie } });
    assert.equal(disabledMemberSession.body.user, null, "disabled users must be signed out immediately");
    const enableMember = await requestJson(`${origin}/api/admin/users/${managedMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ status: "active" }),
    });
    assert.equal(enableMember.response.status, 200, JSON.stringify(enableMember.body));

    const managedRoot = rootUserList.body.users.find((item) => item.username === "root");
    const disableRoot = await requestJson(`${origin}/api/admin/users/${managedRoot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ status: "disabled", role: "member" }),
    });
    assert.equal(disableRoot.response.status, 409, "the primary root account must be protected from lockout");
    const reusedInvite = await requestJson(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ username: "second-user", password: "SecondPassword123!", inviteCode: invite.body.code }),
    });
    assert.equal(reusedInvite.response.status, 403, "a one-use invite must not be reusable");

    const created = await requestJson(`${origin}/api/account/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ name: "E2E Key" }),
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const canvasKey = created.body.key;
    assert.match(canvasKey, /^vc_live_/);
    const listedKeys = await requestJson(`${origin}/api/account/keys`, { headers: { Cookie: cookie } });
    assert.equal(listedKeys.body.apiKeys.length, 1);
    assert.equal(JSON.stringify(listedKeys.body).includes(canvasKey), false, "the full Canvas key must never be returned again");

    const revokedKey = await requestJson(`${origin}/api/account/keys/${created.body.apiKey.id}`, {
        method: "DELETE",
        headers: { Origin: origin, Cookie: cookie },
    });
    assert.equal(revokedKey.response.status, 200);
    const revokedKeyModels = await requestJson(`${origin}/api/gateway/v1/models`, { headers: { Authorization: `Bearer ${canvasKey}` } });
    assert.equal(revokedKeyModels.response.status, 401, "a revoked Canvas key must stop working immediately");
    const replacement = await requestJson(`${origin}/api/account/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify({ name: "E2E Replacement Key" }),
    });
    assert.equal(replacement.response.status, 201);
    const activeCanvasKey = replacement.body.key;

    const models = await requestJson(`${origin}/api/gateway/v1/models`, { headers: { Authorization: `Bearer ${activeCanvasKey}` } });
    assert.equal(models.response.status, 200, JSON.stringify(models.body));
    assert.deepEqual(
        models.body.data.map((item) => item.id),
        ["gpt-5.6-sol", "gpt-image-2", "Seedance 2.0-fast-720p"],
    );

    const compatibilityModels = await requestJson(`${origin}/api/tokaxis/v1/models`, { headers: { Authorization: `Bearer ${activeCanvasKey}` } });
    assert.equal(compatibilityModels.response.status, 200, "saved clients using the old same-origin path must keep working");
    const invalidKey = await requestJson(`${origin}/api/gateway/v1/models`, { headers: { Authorization: "Bearer vc_live_invalid" } });
    assert.equal(invalidKey.response.status, 401);

    const agent = await requestJson(`${origin}/api/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "测试 Agent" }] }),
    });
    assert.equal(agent.response.status, 200, JSON.stringify(agent.body));
    assert.equal(agent.body.choices[0].message.content, "站内 Agent 已连通");

    const beforeAgentSession = await wallet(origin, cookie);
    for (let round = 0; round < 6; round += 1) {
        const responseRound = await requestJson(`${origin}/api/gateway/v1/responses`, {
            method: "POST",
            headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-5.6-sol", input: `Agent 内部回合 ${round + 1}` }),
        });
        assert.equal(responseRound.response.status, 200, JSON.stringify(responseRound.body));
    }
    const afterAgentSession = await wallet(origin, cookie);
    assert.equal(afterAgentSession.credits, beforeAgentSession.credits - 1, "multiple model calls in one Agent billing window must charge only one credit");
    assert.equal(afterAgentSession.ledger.filter((entry) => entry.remark.includes("Agent 对话计费")).length, 1, "the Agent billing window must create one visible ledger entry");

    const jobId = "private-image-job-1234567890";
    const imageSubmit = await requestJson(`${origin}/api/image-jobs/${jobId}?operation=generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt: "product image", n: 1 }),
    });
    assert.equal(imageSubmit.response.status, 202, JSON.stringify(imageSubmit.body));
    const imageJob = await waitForImageJob(origin, jobId, cookie);
    assert.equal(imageJob.status, "succeeded", JSON.stringify(imageJob));
    assert.equal(imageJob.results.length, 1);
    const imageResult = await fetch(`${origin}${imageJob.results[0].url}`, { headers: { Cookie: cookie } });
    assert.equal(imageResult.status, 200);
    assert.equal(imageResult.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await imageResult.arrayBuffer()), ONE_PIXEL_PNG);
    const imageCallsBeforeDuplicate = requests.filter((item) => item.url === "/v1/images/generations").length;
    const duplicateImage = await requestJson(`${origin}/api/image-jobs/${jobId}?operation=generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt: "product image", n: 1 }),
    });
    assert.equal(duplicateImage.response.status, 200);
    assert.equal(requests.filter((item) => item.url === "/v1/images/generations").length, imageCallsBeforeDuplicate, "an existing image job must not create or charge another request");

    const video = await requestJson(`${origin}/api/gateway/v1/videos/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "Seedance 2.0-fast-720p", prompt: "product video", duration: 10, resolution: "720p", aspect_ratio: "9:16" }),
    });
    assert.equal(video.response.status, 200, JSON.stringify(video.body));
    assert.equal(video.body.id, "task_private_gateway_video");
    const videoPoll = await requestJson(`${origin}/api/gateway/v1/videos/generations/task_private_gateway_video`, { headers: { Authorization: `Bearer ${activeCanvasKey}` } });
    assert.equal(videoPoll.response.status, 200);
    assert.equal(videoPoll.body.status, "completed");

    const beforeCompatibilityVideo = await wallet(origin, cookie);
    const compatibilityVideo = await requestJson(`${origin}/api/gateway/v1/contents/generations/tasks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "Seedance 2.0-fast-720p", prompt: "compatibility video", duration: 5 }),
    });
    assert.equal(compatibilityVideo.response.status, 200, JSON.stringify(compatibilityVideo.body));
    assert.equal((await wallet(origin, cookie)).credits, beforeCompatibilityVideo.credits - 3, "a compatibility video task must stay reserved after submission");
    const compatibilityVideoPoll = await requestJson(`${origin}/api/gateway/v1/contents/generations/tasks/task_compatibility_video`, { headers: { Authorization: `Bearer ${activeCanvasKey}` } });
    assert.equal(compatibilityVideoPoll.response.status, 200);
    assert.equal(compatibilityVideoPoll.body.status, "failed");
    assert.equal((await wallet(origin, cookie)).credits, beforeCompatibilityVideo.credits, "a failed compatibility video task must refund its reservation");

    const beforeRejected = await wallet(origin, cookie);
    const rejected = await requestJson(`${origin}/api/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "trigger-moderation" }] }),
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.message, "提交的内容或参考素材未通过安全审核，请调整后重试");
    assert.doesNotMatch(JSON.stringify(rejected.body), /flow2api|tokaxis|yumeng|https?:\/\//i);
    assert.equal((await wallet(origin, cookie)).credits, beforeRejected.credits, "a rejected request must refund its reservation");

    const idempotencyHeader = "e2e-agent-once";
    const onceBody = JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "only once" }] });
    const once = await requestJson(`${origin}/api/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json", "X-Canvas-Request-Id": idempotencyHeader },
        body: onceBody,
    });
    assert.equal(once.response.status, 200);
    const agentCallsBeforeDuplicate = requests.filter((item) => item.url === "/v1/chat/completions").length;
    const duplicate = await requestJson(`${origin}/api/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeCanvasKey}`, "Content-Type": "application/json", "X-Canvas-Request-Id": idempotencyHeader },
        body: onceBody,
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(requests.filter((item) => item.url === "/v1/chat/completions").length, agentCallsBeforeDuplicate, "a settled request id must never reach the model twice");

    const finalWallet = await wallet(origin, cookie);
    assert.equal(finalWallet.creditsPerYuan, 10);
    assert.equal(finalWallet.credits, 90, "1 chat + 1 Agent session + 1 image + 10-second video + 1 idempotent chat must cost exactly 10 credits");
    assert.ok(
        finalWallet.ledger.some((entry) => entry.type === "refund"),
        "failed generation must leave a refund ledger entry",
    );

    const ttsHandoff = await requestJson(`${origin}/api/tts/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(ttsHandoff.response.status, 400);
    assert.equal(ttsHandoff.body.error, "api_key_required", "the standalone TTS handoff must require an explicit station API key");
    assert.doesNotMatch(JSON.stringify(ttsHandoff.body), /https?:\/\//i, "an incomplete TTS handoff must not reveal an external website");

    const modelRequests = requests.filter((item) => item.url?.startsWith("/v1/"));
    assert.ok(modelRequests.length > 0);
    assert.ok(
        modelRequests.every((item) => item.authorization === "Bearer upstream-service-secret"),
        "only the server-owned credential may reach the upstream model service",
    );
    assert.ok(
        modelRequests.every((item) => !JSON.stringify(item).includes(activeCanvasKey)),
        "the customer Canvas key must never be forwarded upstream",
    );

    process.stdout.write(
        JSON.stringify(
            {
                passed: true,
                login: "canvas-session",
                inviteRegistration: "ok",
                userManagement: "root-only",
                rootLockoutProtection: "ok",
                keyRevocation: "immediate",
                models: models.body.data.length,
                agent: "ok",
                image: "ok",
                video: "ok",
                moderationRefund: "ok",
                idempotency: "ok",
                credits: finalWallet.credits,
                creditsPerYuan: finalWallet.creditsPerYuan,
                upstreamCredentialIsolation: "ok",
                ttsHandoffGuard: "ok",
            },
            null,
            2,
        ) + "\n",
    );
} finally {
    app?.kill("SIGTERM");
    await closeServer(upstream);
    await rm(testDirectory, { recursive: true, force: true });
}

async function wallet(origin, cookie) {
    const result = await requestJson(`${origin}/api/account/wallet`, { headers: { Cookie: cookie } });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
}

async function waitForImageJob(origin, jobId, cookie) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await requestJson(`${origin}/api/image-jobs/${jobId}`, { headers: { Cookie: cookie } });
        assert.equal(result.response.status, 200, JSON.stringify(result.body));
        if (result.body.status !== "running") return result.body;
        await delay(25);
    }
    throw new Error("image job did not finish");
}

async function requestJson(url, init = {}) {
    const response = await fetch(url, { ...init, redirect: "manual" });
    const text = await response.text();
    return { response, body: parseJson(text) ?? text };
}

async function waitForServer(url, processHandle, output) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`local canvas exited early (${processHandle.exitCode})\n${output()}`);
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {}
        await delay(100);
    }
    throw new Error(`local canvas did not start\n${output()}`);
}

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not expose a TCP port");
    return address.port;
}

async function freePort() {
    const server = createServer();
    const port = await listen(server);
    await closeServer(server);
    return port;
}

async function closeServer(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function parseJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
