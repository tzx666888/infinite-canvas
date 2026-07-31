import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const jobDirectory = await mkdtemp(path.join(tmpdir(), "canvas-image-jobs-"));
let upstreamCalls = 0;

const upstream = createServer((request, response) => {
    upstreamCalls += 1;
    let requestBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
        requestBody += chunk;
    });
    request.on("end", () => {
        const respond = () => {
            if (requestBody.includes("invalid-image")) {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ data: [{ b64_json: Buffer.from("definitely not an image payload").toString("base64") }] }));
                return;
            }
            if (requestBody.includes("content-moderated")) {
                response.statusCode = 400;
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ error: { message: "imagine:content-moderated" } }));
                return;
            }
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] }));
        };
        if (requestBody.includes("cancel-me")) setTimeout(respond, 250);
        else respond();
    });
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const address = upstream.address();
if (!address || typeof address === "string") throw new Error("mock upstream did not start");

process.env.IMAGE_JOB_DIR = jobDirectory;
process.env.TOKAXIS_INTERNAL_ORIGIN = `http://127.0.0.1:${address.port}`;

const { cancelImageJob, collectImageJobOutputs, getImageJob, readImageJobResult, submitImageJob, toPublicImageJob } = await import("../src/server/image-job-store.ts");

try {
    const nestedOutputs = collectImageJobOutputs({
        choices: [
            {
                message: {
                    images: [{ image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}` } }],
                },
            },
        ],
    });
    assert.equal(nestedOutputs.length, 1, "chat image payload must expose one recoverable output");

    const jobId = "image-job-recovery-test-0001";
    const firstSubmission = {
        id: jobId,
        operation: "generations" as const,
        authorization: "Bearer test",
        contentType: "application/json",
        body: new TextEncoder().encode(JSON.stringify({ model: "gpt-image-2", prompt: "test" })).buffer,
    };
    await Promise.all([submitImageJob(firstSubmission), submitImageJob(firstSubmission)]);

    let job = await getImageJob(jobId);
    for (let index = 0; index < 100 && job?.status === "running"; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        job = await getImageJob(jobId);
    }
    assert.equal(job?.status, "succeeded", "server job must finish after the submitting page goes away");
    assert.equal(job?.results?.length, 1);
    assert.equal(upstreamCalls, 1, "concurrent submissions with one job id must create only one paid request");

    const publicJob = toPublicImageJob(job!);
    assert.equal(publicJob.results?.[0]?.url, `/api/image-jobs/${jobId}/result/0`);

    const result = await readImageJobResult(jobId, 0);
    assert.ok(result);
    assert.equal(result?.mimeType, "image/png");
    assert.deepEqual(result?.bytes, ONE_PIXEL_PNG);

    await submitImageJob({
        id: jobId,
        operation: "generations",
        authorization: "Bearer test",
        contentType: "application/json",
        body: new TextEncoder().encode("{}").buffer,
    });
    assert.equal(upstreamCalls, 1, "re-submitting a persisted job id must not create a second paid request");

    const metadata = JSON.parse(await readFile(path.join(jobDirectory, `${jobId}.json`), "utf8")) as { status?: string };
    assert.equal(metadata.status, "succeeded");

    const cancelJobId = "image-job-recovery-test-0002";
    await submitImageJob({
        id: cancelJobId,
        operation: "generations",
        authorization: "Bearer test",
        contentType: "application/json",
        body: new TextEncoder().encode(JSON.stringify({ model: "gpt-image-2", prompt: "cancel-me" })).buffer,
    });
    const canceledJob = await cancelImageJob(cancelJobId);
    assert.equal(canceledJob?.status, "failed", "explicit stop must cancel the server-side upstream request");
    assert.equal(canceledJob?.error, "图片任务已取消");

    const invalidImageJobId = "image-job-recovery-test-0003";
    await submitImageJob({
        id: invalidImageJobId,
        operation: "generations",
        authorization: "Bearer test",
        contentType: "application/json",
        body: new TextEncoder().encode(JSON.stringify({ model: "gpt-image-2", prompt: "invalid-image" })).buffer,
    });
    const invalidImageJob = await waitForTerminalJob(invalidImageJobId, getImageJob);
    assert.equal(invalidImageJob?.status, "failed");
    assert.match(invalidImageJob?.error || "", /损坏或不受支持的图片/, "invalid bytes must never be exposed as a successful image result");

    const moderatedJobId = "image-job-recovery-test-0004";
    await submitImageJob({
        id: moderatedJobId,
        operation: "generations",
        authorization: "Bearer test",
        contentType: "application/json",
        body: new TextEncoder().encode(JSON.stringify({ model: "gpt-image-2", prompt: "content-moderated" })).buffer,
    });
    const moderatedJob = await waitForTerminalJob(moderatedJobId, getImageJob);
    assert.equal(moderatedJob?.status, "failed");
    assert.equal(moderatedJob?.error, "imagine:content-moderated", "content moderation must preserve the real upstream reason");

    const canvasClientSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/canvas/[id]/canvas-client-page.tsx"), "utf8");
    assert.match(canvasClientSource, /if \(generationRequestsRef\.current\.has\(pendingNode\.id\)\) return;/, "reload recovery must not take over and abort a live image submission");
    assert.match(canvasClientSource, /await runWithConcurrency\(\s*targetIds,\s*IMAGE_TASK_CONCURRENCY_LIMIT,\s*async \(targetId, targetIndex\) =>/, "generic image batches must allow all selected tasks while the API layer bounds uploads");

    const imageApiSource = await readFile(path.join(import.meta.dirname, "../src/services/api/image.ts"), "utf8");
    assert.match(imageApiSource, /return status === 408 \|\| status >= 500;/, "gateway submit failures must be treated as ambiguous");
    assert.match(imageApiSource, /return resumeCanvasImageJobAfterAmbiguousSubmit\(jobId, submitError, options\);/, "ambiguous submissions must probe their persisted job before failing");

    process.stdout.write("image job recovery regression passed\n");
} finally {
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    await rm(jobDirectory, { recursive: true, force: true });
}

async function waitForTerminalJob<T extends { status: string }>(jobId: string, getJob: (id: string) => Promise<T | null>) {
    let job = await getJob(jobId);
    for (let index = 0; index < 100 && job?.status === "running"; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        job = await getJob(jobId);
    }
    return job;
}
