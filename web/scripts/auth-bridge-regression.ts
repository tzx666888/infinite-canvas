import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loginSource = readFileSync(new URL("../src/app/api/auth/login/route.ts", import.meta.url), "utf8");
const registerSource = readFileSync(new URL("../src/app/api/auth/register/route.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/lib/auth/store.ts", import.meta.url), "utf8");
const billingSource = readFileSync(new URL("../src/lib/gateway/billing.ts", import.meta.url), "utf8");
const clientInitSource = readFileSync(new URL("../src/components/layout/client-root-init.tsx", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

assert.doesNotMatch(loginSource, /CANVAS_LEGACY_AUTH_ENABLED|verifyTokaxisCredentials|claimExternalAccount|lib\/auth\/tokaxis/);
assert.doesNotMatch(loginSource, /resolveCanvasUpstreamAuthorization|internal\/canvas\/token/, "Canvas login must not create or load a station billing key");
assert.doesNotMatch(registerSource, /resolveCanvasUpstreamAuthorization|internal\/canvas\/token/, "Canvas registration must not create a station billing key");
assert.doesNotMatch(storeSource, /export async function claimExternalAccount/);
assert.doesNotMatch(storeSource, /CANVAS_LEGACY_INITIAL_CREDITS|canvasCredits/);
assert.match(billingSource, /reserveCredits\(/, "Canvas billing must reserve credits in the Canvas ledger");
assert.doesNotMatch(billingSource, /CANVAS_LEGACY_|canvasCredits|migration_credit/);
assert.match(clientInitSource, /createCanvasApiKey\("平台默认 Key"\)/, "registered Canvas customers must receive a local default key");
assert.match(clientInitSource, /syncModelsFromKey\(key\)/, "the local default key must be used to sync the model catalog");
assert.doesNotMatch(envExample, /CANVAS_LEGACY_AUTH_/);

console.log("Canvas auth and billing boundary regression checks passed.");
