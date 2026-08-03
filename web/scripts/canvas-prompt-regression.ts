import assert from "node:assert/strict";

import { buildIdentityPreservingImageEditPrompt, buildIndependentImageStyleVariantPrompt, isVagueStyleChangeRequest, requestsMultiPanelImage } from "../src/lib/image-reference-prompt.ts";
import { composePromptWithUpstreamText } from "../src/app/(user)/canvas/utils/prompt-composition.ts";
import { selectLeafFailureIds } from "../src/app/(user)/canvas/utils/retry-selection.ts";
import { isContentPolicyErrorMessage } from "../src/lib/content-policy-error.ts";

const repeated = "一位身穿黑色蕾丝裙子，带着黑色蕾丝兔子眼罩";

assert.equal(composePromptWithUpstreamText("", [repeated]), repeated);
assert.equal(composePromptWithUpstreamText("生成一个成年模特", [repeated]), `生成一个成年模特\n\n${repeated}`);
assert.equal(composePromptWithUpstreamText(`${repeated}\n\n${repeated}\n\n生成一个成年模特`, [repeated]), `${repeated}\n\n生成一个成年模特`);
assert.equal(composePromptWithUpstreamText("A\r\n\r\nB", ["A", "B", "C"]), "A\n\nB\n\nC");

assert.equal(isContentPolicyErrorMessage("生成的图片可能违反了关于裸露、色情或情色内容的防护限制。"), true);
assert.equal(isContentPolicyErrorMessage("该提示可能违反了我们的内容政策。"), true);
assert.equal(isContentPolicyErrorMessage("PUBLIC_ERROR_AUDIO_FILTERED"), true);
assert.equal(isContentPolicyErrorMessage("upstream worker temporarily unavailable"), false);

const targetReference = [{ id: "image-1" }] as Parameters<typeof buildIdentityPreservingImageEditPrompt>[2];
const differentStyleEdit = buildIdentityPreservingImageEditPrompt("不同风格", true, targetReference);
assert.equal(requestsMultiPanelImage("不同风格"), false);
assert.match(differentStyleEdit, /one continuous full-frame image/i);
assert.match(differentStyleEdit, /never create a collage/i);

const explicitGridEdit = buildIdentityPreservingImageEditPrompt("生成 2x2 四宫格，展示四种不同风格", true, targetReference);
assert.equal(requestsMultiPanelImage("生成 2x2 四宫格，展示四种不同风格"), true);
assert.doesNotMatch(explicitGridEdit, /never create a collage/i);
assert.match(explicitGridEdit, /explicitly requested a multi-panel composition/i);

assert.equal(isVagueStyleChangeRequest("不同风格"), true);
assert.equal(isVagueStyleChangeRequest("换个风格"), true);
assert.equal(isVagueStyleChangeRequest("换一个风格"), true);
assert.equal(isVagueStyleChangeRequest("改成黑白风格"), false);
const firstStyleVariant = buildIndependentImageStyleVariantPrompt(differentStyleEdit, "不同风格", 0, 4);
const secondStyleVariant = buildIndependentImageStyleVariantPrompt(differentStyleEdit, "不同风格", 1, 4);
assert.match(firstStyleVariant, /independent style result 1 of 4/i);
assert.match(secondStyleVariant, /independent style result 2 of 4/i);
assert.match(firstStyleVariant, /one standalone full-frame image/i);
assert.notEqual(firstStyleVariant, secondStyleVariant);
assert.equal(buildIndependentImageStyleVariantPrompt(differentStyleEdit, "改成黑白风格", 0, 4), differentStyleEdit);

assert.deepEqual(
    selectLeafFailureIds(
        ["config", "batch-root", "image-1", "image-2"],
        [
            { fromNodeId: "config", toNodeId: "batch-root" },
            { fromNodeId: "batch-root", toNodeId: "image-1" },
            { fromNodeId: "batch-root", toNodeId: "image-2" },
        ],
    ),
    ["image-1", "image-2"],
);

console.log("canvas prompt regression: ok");
