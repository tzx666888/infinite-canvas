import assert from "node:assert/strict";

import { selectRichMediaNodeIds } from "../src/app/(user)/canvas/utils/canvas-media-budget.ts";

const nodes = Array.from({ length: 80 }, (_, index) => ({
    id: `image-${index}`,
    type: "image",
    title: `image ${index}`,
    position: { x: index * 320, y: 0 },
    width: 300,
    height: 300,
    metadata: { storageKey: `image:${index}` },
}));

const zoomedOut = selectRichMediaNodeIds(nodes, { x: 0, y: 0, k: 0.05 }, { width: 1920, height: 1080 });
assert.equal(zoomedOut.size, 4, "zoomed-out canvases must not decode every media node");

const pinned = selectRichMediaNodeIds(nodes, { x: 0, y: 0, k: 0.05 }, { width: 1920, height: 1080 }, ["image-79"]);
assert.equal(pinned.size, 4);
assert.ok(pinned.has("image-79"), "selected/running media remains available inside the budget");

const zoomedIn = selectRichMediaNodeIds(nodes, { x: 0, y: 0, k: 1 }, { width: 1920, height: 1080 });
assert.equal(zoomedIn.size, 36, "normal zoom keeps a larger but bounded media budget");

console.log("canvas media budget regression passed");
