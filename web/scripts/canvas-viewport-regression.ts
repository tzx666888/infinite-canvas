import assert from "node:assert/strict";

import { resolveVisibleViewportFrame } from "../src/utils/visible-viewport.ts";

assert.deepEqual(resolveVisibleViewportFrame({ innerHeight: 720, visualHeight: 720, offsetTop: 0 }), { height: 720, offsetTop: 0 });
assert.deepEqual(resolveVisibleViewportFrame({ innerHeight: 1241, visualHeight: 1113, offsetTop: 64 }), { height: 1113, offsetTop: 64 });
assert.deepEqual(resolveVisibleViewportFrame({ innerHeight: 900 }), { height: 900, offsetTop: 0 });
assert.deepEqual(resolveVisibleViewportFrame({ innerHeight: 800, visualHeight: 0, offsetTop: -12 }), { height: 800, offsetTop: 0 });

console.log("Canvas visible viewport regression checks passed.");
