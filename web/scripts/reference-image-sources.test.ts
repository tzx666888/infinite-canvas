import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceNodeReferenceImages } from "../src/app/(user)/canvas/utils/reference-image-sources.ts";

test("keeps image references when only storageKey exists", () => {
    const [reference] = buildSourceNodeReferenceImages({
        id: "node-1",
        type: "image",
        title: "参考图",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { storageKey: "image:abc123", mimeType: "image/png" },
    });

    assert.ok(reference);
    assert.equal(reference.storageKey, "image:abc123");
    assert.equal(reference.dataUrl, "");
});

test("ignores non-image nodes and empty image nodes", () => {
    assert.deepEqual(buildSourceNodeReferenceImages({ id: "node-2", type: "text", title: "文本", position: { x: 0, y: 0 }, width: 100, height: 100 }), []);
    assert.deepEqual(buildSourceNodeReferenceImages({ id: "node-3", type: "image", title: "空图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} }), []);
});
