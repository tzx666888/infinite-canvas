import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    claimVideoEnhancementGrant,
    clearVideoEnhancementGrantsForTests,
    commitVideoEnhancementGrant,
    isCompatibleProductBaseModel,
    isInternalVideoEnhancerModel,
    isVideoCreationPath,
    rememberVideoEnhancementGrant,
} from "../src/lib/gateway/video-enhancement-grants.ts";

const serviceSource = await readFile(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const gatewaySource = await readFile(new URL("../src/app/api/gateway/[...path]/route.ts", import.meta.url), "utf8");
const billingSource = await readFile(new URL("../src/lib/gateway/billing.ts", import.meta.url), "utf8");
const composeSource = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");

assert.match(serviceSource, /x-canvas-request-id/, "enhanced video hops must share a gateway request id");
assert.match(serviceSource, /x-canvas-billing-model/, "the base hop must carry the public product billing id");
assert.match(serviceSource, /blobToDataUrl\(baseResult\.blob/, "the enhancer must receive materialized video data");
assert.match(serviceSource, /blobToDataUrl\(await source\.blob\(\)/, "URL results must be downloaded before enhancement");
assert.match(serviceSource, /prompt:\s*VIDEO_ENHANCER_PROMPT/, "the enhancer request must satisfy the gateway prompt requirement");
assert.doesNotMatch(serviceSource, /uploadMediaFile\(baseResult\.blob/, "a browser blob URL must never be handed to the server enhancer");
assert.match(gatewaySource, /claimVideoEnhancementGrant/, "private enhancement requests must require a server-side grant");
assert.match(gatewaySource, /commitVideoEnhancementGrant/, "successful enhancement requests must consume their grant");
assert.match(gatewaySource, /request\.clone\(\)\.formData\(\)/, "multipart Omni requests must expose their model to billing/grant routing");
assert.match(gatewaySource, /x-canvas-billing-model/, "billing metadata must be handled at the gateway");
assert.match(billingSource, /resolveCanvasBillingModel/, "billing overrides must be validated against the request body model");

assert.equal(isVideoCreationPath("v1/videos"), true);
assert.equal(isVideoCreationPath("v1/videos/generations"), true);
assert.equal(isVideoCreationPath("v1/videos/task-123"), false);
assert.equal(isInternalVideoEnhancerModel("tokaxis::1080"), true);
assert.equal(isInternalVideoEnhancerModel("omni-1080p"), false);
assert.equal(isCompatibleProductBaseModel("omni-1080p", "omni"), true);
assert.equal(isCompatibleProductBaseModel("omni-1080p", "sd30"), false);

clearVideoEnhancementGrantsForTests();
rememberVideoEnhancementGrant({ userId: "user-1", requestId: "request-1", publicModel: "omni-1080p", baseModel: "omni" });
const claimed = claimVideoEnhancementGrant({ userId: "user-1", requestId: "request-1", enhancerModel: "1080" });
assert.ok(claimed, "a successful product base request must authorize its matching enhancer hop");
assert.equal(claimVideoEnhancementGrant({ userId: "user-1", requestId: "request-1", enhancerModel: "1080" }), null, "a grant must be single-use");
commitVideoEnhancementGrant(claimed!);

rememberVideoEnhancementGrant({ userId: "user-1", requestId: "request-2", publicModel: "omni-1080p", baseModel: "omni" });
assert.equal(claimVideoEnhancementGrant({ userId: "user-1", requestId: "request-2", enhancerModel: "1080pro" }), null, "a product's normal tier must not authorize the Pro enhancer");

const pricesMatch = /CANVAS_MODEL_PRICES_JSON:\s*'([^']+)'/.exec(composeSource);
assert.ok(pricesMatch, "compose must keep the Canvas product price table");
const prices = JSON.parse(pricesMatch![1]);
for (const model of ["omni-1080p", "omni-1080p-pro", "minimax-h3-1080p", "minimax-h3-1080p-pro", "sd30-1080p", "sd30-1080p-pro"]) {
    assert.equal(prices[model]?.unit, "request", `${model} must be billed per request`);
}
assert.equal(prices["1080"], undefined, "private enhancer ids must not be public catalog/price entries");
assert.equal(prices["1080pro"], undefined, "private enhancer ids must not be public catalog/price entries");

const authDirectory = await mkdtemp(join(tmpdir(), "canvas-enhancer-billing-"));
process.env.AUTH_DATA_DIR = authDirectory;
const { resolveCanvasBillingModel } = await import("../src/lib/gateway/billing.ts");
assert.equal(resolveCanvasBillingModel("omni", "omni-1080p"), "omni-1080p");
assert.equal(resolveCanvasBillingModel("omni_portrait", "omni-1080p-pro"), "omni-1080p-pro");
assert.equal(resolveCanvasBillingModel("sd30", "omni-1080p"), "sd30", "cross-family billing overrides must be ignored");
assert.equal(resolveCanvasBillingModel("omni", "gpt-image-2"), "omni", "arbitrary billing overrides must be ignored");

console.log("Omni enhancement regression checks passed");
