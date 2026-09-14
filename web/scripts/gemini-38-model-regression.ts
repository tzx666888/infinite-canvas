import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { modelDisplayInfo } from "../src/lib/model-display.ts";

const model = "gemini-3.8-flash-high";
const settingsSource = readFileSync(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const imageServiceSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");

assert.match(settingsSource, new RegExp(model.replaceAll(".", "\\.")), "settings API must expose Gemini 3.8 Flash High");
assert.match(configStoreSource, new RegExp(model.replaceAll(".", "\\.")), "persisted Canvas configs must migrate to Gemini 3.8 Flash High");
assert.deepEqual(modelDisplayInfo(model), {
    label: "Gemini 3.8 Flash High",
    description: "Google 高强度推理、编程与复杂任务",
    badge: "Google",
});
assert.match(imageServiceSource, /modelOptionName\(requestConfig\.model\)[\s\S]*?gemini-3\.8-flash-high[\s\S]*?requestChatCompletionToolResponse/, "Gemini 3.8 Agent requests must use the compatible Chat Completions route");
assert.match(imageServiceSource, /aiApiUrl\(config, "\/chat\/completions"\)/, "Gemini 3.8 Chat Completions adapter must call the private gateway");
console.log("Gemini 3.8 Canvas model contract passed");
