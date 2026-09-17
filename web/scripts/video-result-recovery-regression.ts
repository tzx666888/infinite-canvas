import assert from "node:assert/strict";
import { mock } from "node:test";
import axios from "axios";
import { readAudioMeta, readVideoMeta } from "../src/services/file-storage.ts";
import { pollGoogleFlowVideoTaskRequest } from "../src/services/api/video/google-flow-adapter.ts";
import { pollSeedanceVideoTaskRequest } from "../src/services/api/video/seedance-adapter.ts";

// A detached media element can emit neither loadedmetadata nor error (e.g.
// suspended decoding). A successful download must still reach the canvas.
function fakeVideo(width = 0, height = 0, duration = NaN) {
    return {
        videoWidth: width, videoHeight: height, duration, src: "", preload: "", muted: false, playsInline: false,
        onloadedmetadata: null as null | (() => void), onerror: null as null | (() => void),
        loads: 0, removeAttribute() { this.src = ""; }, load() { this.loads++; },
    };
}
let video = fakeVideo();
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => video } });
mock.timers.enable({ apis: ["setTimeout"] });
try {
    const stalled = readVideoMeta("blob:stalled");
    assert.equal(video.preload, "metadata");
    assert.equal(video.loads, 1);
    mock.timers.tick(10_000);
    assert.deepEqual(await stalled, { width: undefined, height: undefined, durationMs: undefined });
    assert.equal(video.src, "");
    assert.equal(video.onloadedmetadata, null);

    video = fakeVideo(720, 1280, 30.08);
    const success = readVideoMeta("blob:sd30");
    video.onloadedmetadata!();
    assert.deepEqual(await success, { width: 720, height: 1280, durationMs: 30080 });
    mock.timers.tick(10_000);
    assert.equal(video.loads, 2, "settled metadata must clean up exactly once");

    video = fakeVideo();
    const invalid = readVideoMeta("blob:invalid");
    video.onerror!();
    assert.equal((await invalid).width, undefined, "unknown dimensions must preserve the node's requested ratio");
    video = fakeVideo();
    const stalledAudio = readAudioMeta("blob:stalled-audio");
    assert.equal(video.preload, "metadata");
    mock.timers.tick(10_000);
    assert.deepEqual(await stalledAudio, { durationMs: undefined });
} finally {
    mock.timers.reset();
    Reflect.deleteProperty(globalThis, "document");
}

const calls: Array<{ url: string; options: any }> = [];
const blob = new Blob(["fixture"], { type: "video/mp4" });
const get = mock.method(axios, "get", async (url: string, options: any) => {
    calls.push({ url, options });
    return { data: url.endsWith("/content") ? blob : { status: "completed", content: { video_url: "http://127.0.0.1:18194/v1/videos/upstream/content" } } };
});
const stages: string[] = [];
try {
    const result = await pollSeedanceVideoTaskRequest({
        endpoint: "https://canvas.test/api/gateway/v1/videos/generations/task-existing",
        contentEndpoint: "https://canvas.test/api/gateway/v1/videos/task-existing/content",
        headers: { Authorization: "Bearer test" }, options: { onProgress: message => stages.push(message) },
    });
    assert.deepEqual(result, { status: "completed", result: { blob } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.timeout, 30_000);
    assert.equal(calls[1].options.timeout, 120_000);
    assert.ok(calls[1].url.includes("task-existing/content"), "recover via authenticated original task, never the upstream localhost URL");
    assert.equal(stages.length, 1);
    calls.length = 0;
    const flowResult = await pollGoogleFlowVideoTaskRequest({ endpoint: "https://canvas.test/v1/videos/task-existing", contentEndpoint: "https://canvas.test/v1/videos/task-existing/content", headers: {} });
    assert.deepEqual(flowResult, { status: "completed", result: { blob } });
    assert.equal(calls[0].options.timeout, 30_000);
    assert.equal(calls[1].options.timeout, 120_000);
} finally {
    get.mock.restore();
}
console.log("Video result recovery: stalled metadata, success, decoder error, original-task content download passed");
