import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { AsyncSemaphore, IMAGE_REQUEST_CONCURRENCY_LIMIT, mapSettledWithConcurrency } from "../src/lib/image-request-concurrency.ts";

let active = 0;
let maximumActive = 0;
const semaphore = new AsyncSemaphore(IMAGE_REQUEST_CONCURRENCY_LIMIT);
await Promise.all(
    Array.from({ length: 8 }, () =>
        semaphore.run(undefined, async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await delay(10);
            active -= 1;
        }),
    ),
);
assert.equal(maximumActive, IMAGE_REQUEST_CONCURRENCY_LIMIT, "the shared image semaphore must cap active requests at two");

const blockingSemaphore = new AsyncSemaphore(1);
let releaseBlockingTask!: () => void;
let markBlockingTaskStarted!: () => void;
const blockingTaskStarted = new Promise<void>((resolve) => {
    markBlockingTaskStarted = resolve;
});
const blockingTask = blockingSemaphore.run(undefined, async () => {
    markBlockingTaskStarted();
    await new Promise<void>((resolve) => {
        releaseBlockingTask = resolve;
    });
});
await blockingTaskStarted;

let canceledTaskRan = false;
const cancelController = new AbortController();
const canceledTask = blockingSemaphore.run(cancelController.signal, async () => {
    canceledTaskRan = true;
});
cancelController.abort();
await assert.rejects(canceledTask, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
releaseBlockingTask();
await blockingTask;
assert.equal(canceledTaskRan, false, "a queued request canceled by the user must never start");

active = 0;
maximumActive = 0;
const settled = await mapSettledWithConcurrency([0, 1, 2, 3, 4], IMAGE_REQUEST_CONCURRENCY_LIMIT, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await delay(5);
    active -= 1;
    if (value === 2) throw new Error("expected failure");
    return value * 2;
});
assert.equal(maximumActive, IMAGE_REQUEST_CONCURRENCY_LIMIT);
assert.deepEqual(
    settled.map((result) => result.status),
    ["fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"],
    "limited batches must preserve result order and individual failures",
);

const canvasSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/canvas/[id]/canvas-client-page.tsx"), "utf8");
const imagePageSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/image/page.tsx"), "utf8");
const batchPageSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/batch/page.tsx"), "utf8");
const imageApiSource = await readFile(path.join(import.meta.dirname, "../src/services/api/image.ts"), "utf8");

assert.match(canvasSource, /runWithConcurrency\(retryNodes, IMAGE_REQUEST_CONCURRENCY_LIMIT,/, "one-click canvas retry must use the shared limit");
assert.match(imagePageSource, /mapSettledWithConcurrency\(slots, IMAGE_REQUEST_CONCURRENCY_LIMIT,/, "the image workbench must not launch every slot at once");
assert.match(batchPageSource, /Math\.min\(concurrency, IMAGE_REQUEST_CONCURRENCY_LIMIT, selected\.length\)/, "the batch workbench must enforce the shared limit");
assert.equal((imageApiSource.match(/imageRequestSemaphore\.run/g) || []).length, 2, "generation and edit requests must both use the shared semaphore");
assert.doesNotMatch(imageApiSource, /Promise\.all\(requests\)/, "a single Gemini request must not fan out behind the shared semaphore");

process.stdout.write("image concurrency regression passed\n");

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
