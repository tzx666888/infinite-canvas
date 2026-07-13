import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import { POST } from "../src/app/api/tokaxis/[...path]/route";

const capturedBodies: Array<Record<string, unknown>> = [];
const originalFetch = globalThis.fetch;
let stubStatus = 200;
let stubThrows = false;

globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
    if (stubThrows) throw new Error("simulated connection loss after submission");
    const responseBody = stubStatus >= 400 ? { error: { message: "simulated upstream failure" } } : { id: `task_contract_${capturedBodies.length}`, status: "pending" };
    return new Response(JSON.stringify(responseBody), {
        status: stubStatus,
        headers: { "Content-Type": "application/json" },
    });
}) as typeof fetch;

async function create(payload: Record<string, unknown>) {
    const request = new NextRequest("http://localhost/api/tokaxis/v1/videos/generations", {
        method: "POST",
        headers: { Authorization: "Bearer contract-test", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return POST(request, { params: { path: ["v1", "videos", "generations"] } });
}

try {
    const image = { url: "data:image/png;base64,iVBORw0KGgo=" };
    const storageOptions = { filename: "contract.mp4", public_url: true };
    const i2vResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "STORYBOARD-DIRECTED VIDEO. Keep the same person.",
        duration: 15,
        aspect_ratio: "9:16",
        resolution: "720p",
        image,
        storage_options: storageOptions,
    });
    assert.equal(i2vResponse.status, 200);
    const i2v = capturedBodies.at(-1)!;
    assert.equal(i2v.image, image.url, "I2V image must use the legacy gateway's string wire format");
    assert.equal("reference_images" in i2v, false);
    assert.equal("images" in i2v, false);
    assert.equal(i2v.duration, 15);
    assert.equal(i2v.seconds, "15");
    assert.deepEqual(i2v.storage_options, storageOptions);

    const stringImageResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Animate the exact opening frame.",
        duration: 6,
        image: image.url,
    });
    assert.equal(stringImageResponse.status, 200);
    assert.equal(capturedBodies.at(-1)!.image, image.url, "a legacy string image input must remain a string on the gateway wire");

    const requestCountBeforeFileId = capturedBodies.length;
    const fileIdResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Unsupported legacy file input.",
        duration: 6,
        image: { file_id: "file_contract" },
    });
    assert.equal(fileIdResponse.status, 400, "the legacy string DTO must reject file_id instead of mislabeling it as a URL");
    assert.equal(capturedBodies.length, requestCountBeforeFileId, "an unsupported file_id must fail before upstream POST");

    const r2vResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Use the same identity.",
        duration: 15,
        aspect_ratio: "9:16",
        reference_images: [image],
    });
    assert.equal(r2vResponse.status, 200);
    const r2v = capturedBodies.at(-1)!;
    assert.deepEqual(r2v.reference_images, [image], "R2V references must keep their field and order");
    assert.equal("image" in r2v, false);
    assert.equal("images" in r2v, false);
    assert.equal(r2v.duration, 10, "Fast R2V must honor the official 10-second limit");
    assert.equal(r2v.seconds, "10");

    const t2vResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "A beach at sunrise.",
        duration: 15,
        aspect_ratio: "9:16",
    });
    assert.equal(t2vResponse.status, 200);
    const t2v = capturedBodies.at(-1)!;
    assert.equal("image" in t2v, false);
    assert.equal("reference_images" in t2v, false);
    assert.equal("images" in t2v, false);
    assert.equal(t2v.duration, 15);

    const requestCountBeforeConflict = capturedBodies.length;
    const conflictResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Invalid mixed mode.",
        duration: 10,
        image,
        reference_images: [image],
    });
    assert.equal(conflictResponse.status, 400);
    assert.equal(capturedBodies.length, requestCountBeforeConflict, "mixed mode must fail before any upstream POST");

    const invalidStorageResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Invalid storage options.",
        duration: 6,
        storage_options: "invalid",
    });
    assert.equal(invalidStorageResponse.status, 400);
    assert.equal(capturedBodies.length, requestCountBeforeConflict, "invalid storage_options must fail before upstream POST");

    stubStatus = 503;
    const requestCountBeforeFailure = capturedBodies.length;
    const failureResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Do not duplicate this billable request.",
        duration: 6,
    });
    assert.equal(failureResponse.status, 424, "ambiguous 5xx create result must be marked unknown");
    assert.equal(capturedBodies.length, requestCountBeforeFailure + 1, "a failed create must be POSTed exactly once");

    stubStatus = 200;
    stubThrows = true;
    const requestCountBeforeDisconnect = capturedBodies.length;
    const disconnectResponse = await create({
        model: "grok-imagine-video-1.5-fast",
        prompt: "Do not duplicate after a connection loss.",
        duration: 6,
    });
    assert.equal(disconnectResponse.status, 424);
    assert.equal(capturedBodies.length, requestCountBeforeDisconnect + 1, "a disconnected create must be POSTed exactly once");

    console.log("video proxy contract regression: passed");
} finally {
    globalThis.fetch = originalFetch;
}
