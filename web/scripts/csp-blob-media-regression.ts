import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const csp = nextConfig.match(/value:\s*"([^"]*connect-src[^\"]*)"/)?.[1] || "";

assert.ok(csp, "Next.js security headers must include a Content Security Policy");
assert.match(csp, /img-src[^;]*\bblob:/, "Canvas must be allowed to display locally stored image blobs");
assert.match(csp, /media-src[^;]*\bblob:/, "Canvas must be allowed to play locally stored media blobs");
assert.match(csp, /connect-src[^;]*\bblob:/, "Canvas must be allowed to read local image and media blobs before generation uploads");

console.log("CSP blob media regression: ok");
