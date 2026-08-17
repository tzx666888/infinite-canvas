import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loginSource = readFileSync(new URL("../src/app/api/auth/login/route.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/lib/auth/store.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

assert.doesNotMatch(loginSource, /CANVAS_LEGACY_AUTH_ENABLED|verifyTokaxisCredentials|claimExternalAccount|lib\/auth\/tokaxis/);
assert.doesNotMatch(storeSource, /export async function claimExternalAccount/);
assert.doesNotMatch(envExample, /CANVAS_LEGACY_AUTH_/);

console.log("Canvas auth boundary regression checks passed.");
