import assert from "node:assert/strict";

import { buildImageReferencePromptText, buildIdentityPreservingImageEditPrompt, buildIndependentImageStyleVariantPrompt, isVagueStyleChangeRequest, requestsMultiPanelImage } from "../src/lib/image-reference-prompt.ts";
import { composePromptWithUpstreamText } from "../src/app/(user)/canvas/utils/prompt-composition.ts";
import { selectLeafFailureIds } from "../src/app/(user)/canvas/utils/retry-selection.ts";
import { isContentPolicyErrorMessage } from "../src/lib/content-policy-error.ts";
import { TOKAXIS_PROMPTS } from "../src/lib/tokaxis-prompts.ts";

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

assert.equal(requestsMultiPanelImage("生成一组不同场景电商详情图"), false);
assert.equal(requestsMultiPanelImage("生成不同场景详情图"), false);
const commerceDetailPrompt = "生成一组不同场景电商详情图";
const configNodeCommercePrompt = buildIdentityPreservingImageEditPrompt(commerceDetailPrompt, false, targetReference);
assert.equal(configNodeCommercePrompt, commerceDetailPrompt);
assert.equal(buildIndependentImageStyleVariantPrompt(configNodeCommercePrompt, commerceDetailPrompt, 0, 9), commerceDetailPrompt);
assert.equal(buildImageReferencePromptText(configNodeCommercePrompt, targetReference), "参考图片按上传顺序固定编号为：图片1。\n必须严格按编号理解图片角色，不得交换、合并或混淆不同图片中的主体。\n\n生成一组不同场景电商详情图");
const directImageCommercePrompt = buildIdentityPreservingImageEditPrompt(commerceDetailPrompt, true, targetReference);
assert.match(directImageCommercePrompt, /preserve its composition/i);
assert.doesNotMatch(directImageCommercePrompt, /commerce detail set interpretation|reference-derived image generation|independent detail-image/i);

const h3DirectorPrompt = TOKAXIS_PROMPTS.find((item) => item.id === "tokaxis_indonesia_tiktok_h3_director_v2");
assert.ok(h3DirectorPrompt, "Indonesia TikTok H3 director prompt should be available");
assert.equal(h3DirectorPrompt.action, "agent_workflow");
assert.match(h3DirectorPrompt.prompt, /0–3 秒 Hook/);
assert.match(h3DirectorPrompt.prompt, /Bahasa 口播和 Bahasa 字幕（分开）/);
assert.match(h3DirectorPrompt.prompt, /可直接投喂 H3/);
assert.match(h3DirectorPrompt.prompt, /文字清晰度/);

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
