import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { AsyncSemaphore, IMAGE_SUBMISSION_CONCURRENCY_LIMIT, IMAGE_TASK_CONCURRENCY_LIMIT, mapSettledWithConcurrency, runImageSubmission } from "../src/lib/image-request-concurrency.ts";

let active = 0;
let maximumActive = 0;
const semaphore = new AsyncSemaphore(IMAGE_SUBMISSION_CONCURRENCY_LIMIT);
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
assert.equal(maximumActive, IMAGE_SUBMISSION_CONCURRENCY_LIMIT, "image submission must cap active uploads at two");

let activeSubmissions = 0;
let maximumSubmissions = 0;
let pollingTasks = 0;
let markAllPolling!: () => void;
let releasePolling!: () => void;
const allPolling = new Promise<void>((resolve) => {
    markAllPolling = resolve;
});
const pollingGate = new Promise<void>((resolve) => {
    releasePolling = resolve;
});
const submittedJobs = Array.from({ length: 6 }, (_, index) =>
    (async () => {
        const jobId = await runImageSubmission(undefined, async () => {
            activeSubmissions += 1;
            maximumSubmissions = Math.max(maximumSubmissions, activeSubmissions);
            await delay(5);
            activeSubmissions -= 1;
            return index;
        });
        pollingTasks += 1;
        if (pollingTasks === 6) markAllPolling();
        await pollingGate;
        return jobId;
    })(),
);
await allPolling;
assert.equal(maximumSubmissions, IMAGE_SUBMISSION_CONCURRENCY_LIMIT, "only two uploads may overlap");
assert.equal(pollingTasks, 6, "all server jobs must enter polling without waiting for earlier generations to finish");
releasePolling();
assert.deepEqual(await Promise.all(submittedJobs), [0, 1, 2, 3, 4, 5]);

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
const settled = await mapSettledWithConcurrency([0, 1, 2, 3, 4], IMAGE_SUBMISSION_CONCURRENCY_LIMIT, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await delay(5);
    active -= 1;
    if (value === 2) throw new Error("expected failure");
    return value * 2;
});
assert.equal(maximumActive, IMAGE_SUBMISSION_CONCURRENCY_LIMIT);
assert.deepEqual(
    settled.map((result) => result.status),
    ["fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"],
    "limited batches must preserve result order and individual failures",
);

const canvasSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/canvas/[id]/canvas-client-page.tsx"), "utf8");
const imagePageSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/image/page.tsx"), "utf8");
const batchPageSource = await readFile(path.join(import.meta.dirname, "../src/app/(user)/batch/page.tsx"), "utf8");
const imageApiSource = await readFile(path.join(import.meta.dirname, "../src/services/api/image.ts"), "utf8");

assert.equal(IMAGE_TASK_CONCURRENCY_LIMIT, 10, "the canvas must be able to run all ten selected image tasks");
assert.match(canvasSource, /runWithConcurrency\(retryNodes, IMAGE_TASK_CONCURRENCY_LIMIT,/, "one-click canvas retry must restore task concurrency");
assert.match(imagePageSource, /mapSettledWithConcurrency\(slots, IMAGE_TASK_CONCURRENCY_LIMIT,/, "the image workbench must submit all selected tasks");
assert.match(batchPageSource, /const MAX_BATCH_CONCURRENCY = 5;/, "the batch workbench must restore its configurable concurrency");
assert.match(batchPageSource, /Math\.min\(concurrency, selected\.length\)/, "the batch worker must honor the selected task concurrency");
assert.match(imageApiSource, /response = await runImageSubmission\(options\.signal, async \(\) => \{/, "resumable jobs must limit only their submission stage");
assert.match(imageApiSource, /return resumeCanvasImageJob\(jobId, options\);/, "polling must continue after the submission permit is released");
assert.doesNotMatch(imageApiSource, /imageRequestSemaphore/, "image generation must not hold a semaphore while polling");
assert.doesNotMatch(imageApiSource, /Promise\.all\(requests\)/, "a single Gemini request must not fan out behind the shared semaphore");

process.stdout.write("image concurrency regression passed\n");

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
