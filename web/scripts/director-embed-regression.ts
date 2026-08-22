import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { prepareDirectorPanoramas, prepareDirectorSessionPayload } from "../src/app/(user)/canvas/components/director/director-embed-safety.ts";

const project = { version: 1, objects: [{ id: "character-1" }] };
const session = prepareDirectorSessionPayload({ instanceId: "director-1", theme: "dark", project });
assert.deepEqual(session, { instanceId: "director-1", theme: "dark", project });
assert.notEqual(session.project, project, "iframe payload must be a detached serializable clone");

const circular: Record<string, unknown> = {};
circular.self = circular;
assert.deepEqual(prepareDirectorSessionPayload({ instanceId: "director-2", theme: "light", project: circular }), { instanceId: "director-2", theme: "light" }, "invalid saved projects must be omitted instead of crashing the canvas");

const oversizedProject = { text: "x".repeat(4_000_001) };
assert.deepEqual(prepareDirectorSessionPayload({ instanceId: "director-3", theme: "dark", project: oversizedProject }), { instanceId: "director-3", theme: "dark" });

const panoramas = Array.from({ length: 12 }, (_, index) => ({ id: index, imageUrl: `https://example.test/${index}.png` }));
assert.equal(prepareDirectorPanoramas(panoramas).length, 8, "only a bounded number of panorama references may enter the iframe");
assert.deepEqual(prepareDirectorPanoramas([{ id: 1, imageUrl: "ok" }, circular]), [{ id: 1, imageUrl: "ok" }]);

const directorHtml = readFileSync(new URL("../public/director/index.html", import.meta.url), "utf8");
const hostBridge = readFileSync(new URL("../public/director/host-bridge.js", import.meta.url), "utf8");
assert.match(directorHtml, /<script src="\/director\/host-bridge\.js"><\/script>/, "director shell must load the reliable host handshake before the application bundle");
assert.match(hostBridge, /\.app-shell/, "host handshake must wait until the director UI has mounted");
assert.match(hostBridge, /storyai:director-session/, "host handshake must stop only after the parent acknowledges the session");

console.log("Director embed safety regression checks passed.");
