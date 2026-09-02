import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facadeSource = readFileSync(new URL("../src/lib/video-model-settings.ts", import.meta.url), "utf8");
const googlePolicySource = readFileSync(new URL("../src/lib/video-providers/google-video.ts", import.meta.url), "utf8");
const grokPolicySource = readFileSync(new URL("../src/lib/video-providers/grok-video.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const googleAdapterSource = readFileSync(new URL("../src/services/api/video/google-flow-adapter.ts", import.meta.url), "utf8");
const seedanceAdapterSource = readFileSync(new URL("../src/services/api/video/seedance-adapter.ts", import.meta.url), "utf8");

assert.doesNotMatch(facadeSource, /veo_3_1_|grok-imagine-video-/, "the common video facade must not own vendor model IDs");
assert.match(googlePolicySource, /veo_3_1_t2v_fast_landscape/, "Google model IDs must live in the Google policy module");
assert.doesNotMatch(googlePolicySource, /grok-imagine-video-|Seedance/, "Google policy must not contain another provider's models");
assert.match(grokPolicySource, /grok-imagine-video-1\.5-fast/, "Grok model IDs must live in the Grok policy module");
assert.doesNotMatch(grokPolicySource, /veo_3_1_|Seedance/, "Grok policy must not contain another provider's models");

assert.match(serviceSource, /createGoogleFlowVideoTaskRequest/, "the public video service must delegate Google transport");
assert.match(serviceSource, /createSeedanceVideoTaskRequest/, "the public video service must delegate Seedance transport");
assert.doesNotMatch(serviceSource, /body\.(?:append|set)\("input_reference"/, "the public video service must not implement Google reference multipart transport");
assert.match(googleAdapterSource, /new FormData\(\)/, "Google multipart transport must live in its adapter");
assert.match(googleAdapterSource, /provider: "google-flow"/, "Google tasks must carry an explicit provider identity");
assert.match(googleAdapterSource, /input_reference/, "Google reference uploads must stay in the Google adapter");
assert.doesNotMatch(googleAdapterSource, /Seedance|contents\/generations/, "Google transport must not contain Seedance protocol details");
assert.match(seedanceAdapterSource, /provider: "seedance"/, "Seedance task semantics must live in the Seedance adapter");
assert.doesNotMatch(seedanceAdapterSource, /input_reference|veo_3_1_|omni_portrait/, "Seedance transport must not contain Google protocol or model details");

console.log("Video provider isolation regression checks passed");
