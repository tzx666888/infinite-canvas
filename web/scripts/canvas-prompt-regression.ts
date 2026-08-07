import assert from "node:assert/strict";

import {
    buildCommerceDetailSetVariantPrompt,
    buildIdentityPreservingImageEditPrompt,
    buildIndependentImageStyleVariantPrompt,
    isCommerceDetailSetRequest,
    isReferenceDerivedImageGenerationRequest,
    isVagueStyleChangeRequest,
    requestsMultiPanelImage,
} from "../src/lib/image-reference-prompt.ts";
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

assert.equal(isCommerceDetailSetRequest("生成一组不同场景电商详情图"), true);
assert.equal(isCommerceDetailSetRequest("生成不同场景详情图"), true);
assert.equal(isCommerceDetailSetRequest("帮我生成一张电商详情图"), false);
assert.equal(isReferenceDerivedImageGenerationRequest("生成一组不同场景电商详情图"), true);
assert.equal(isReferenceDerivedImageGenerationRequest("生成电商白底图"), true);
assert.equal(isReferenceDerivedImageGenerationRequest("把背景改成白色"), false);
assert.equal(isReferenceDerivedImageGenerationRequest("不同风格"), false);

const commerceDetailEdit = buildIdentityPreservingImageEditPrompt("生成一组不同场景电商详情图", true, targetReference);
assert.match(commerceDetailEdit, /authoritative product or subject identity reference/i);
assert.match(commerceDetailEdit, /not a composition template/i);
assert.doesNotMatch(commerceDetailEdit, /preserve its composition/i);
assert.doesNotMatch(commerceDetailEdit, /never create a collage/i);
assert.doesNotMatch(commerceDetailEdit, /one continuous full-frame image/i);
assert.match(commerceDetailEdit, /do not force a fixed grid or panel count/i);
assert.equal(requestsMultiPanelImage("生成一组不同场景电商详情图"), false);
assert.equal(requestsMultiPanelImage("生成不同场景详情图"), false);
const explicitCommerceGridEdit = buildIdentityPreservingImageEditPrompt("生成一组 2x2 电商详情图", true, targetReference);
assert.match(explicitCommerceGridEdit, /explicitly requested a multi-panel composition/i);
assert.doesNotMatch(explicitCommerceGridEdit, /do not force a fixed grid or panel count/i);
const explicitCommerceGridVariant = buildCommerceDetailSetVariantPrompt(explicitCommerceGridEdit, "生成一组 2x2 电商详情图", 0, 4);
assert.match(explicitCommerceGridVariant, /honor the exact layout and panel count/i);
assert.doesNotMatch(explicitCommerceGridVariant, /distinct layout direction|never force a fixed grid/i);

const firstCommerceDetail = buildCommerceDetailSetVariantPrompt(commerceDetailEdit, "生成一组不同场景电商详情图", 0, 4);
const secondCommerceDetail = buildCommerceDetailSetVariantPrompt(commerceDetailEdit, "生成一组不同场景电商详情图", 1, 4);
const customerCommerceDetailEdit = buildIdentityPreservingImageEditPrompt("生成不同场景详情图", true, targetReference);
const customerCommerceDetail = buildCommerceDetailSetVariantPrompt(customerCommerceDetailEdit, "生成不同场景详情图", 0, 10);
assert.match(firstCommerceDetail, /one standalone e-commerce detail image/i);
assert.match(firstCommerceDetail, /never force a fixed grid, fixed panel count, or the same layout across the set/i);
assert.match(firstCommerceDetail, /independent detail-image result 1 of 4/i);
assert.match(secondCommerceDetail, /independent detail-image result 2 of 4/i);
assert.doesNotMatch(firstCommerceDetail, /2x2|exactly four coherent panels/i);
assert.match(customerCommerceDetail, /independent detail-image result 1 of 10/i);
assert.match(customerCommerceDetail, /distinct scene direction/i);
assert.match(customerCommerceDetail, /distinct layout direction/i);
assert.doesNotMatch(customerCommerceDetail, /one continuous full-frame image|2x2|exactly four coherent panels/i);
assert.notEqual(firstCommerceDetail, secondCommerceDetail);
const commerceDetailDirections = Array.from({ length: 15 }, (_, index) => buildCommerceDetailSetVariantPrompt(commerceDetailEdit, "生成一组不同场景电商详情图", index, 15));
const commerceDetailDirectionPairs = commerceDetailDirections.map((value) => value.match(/Distinct (?:scene|layout) direction[^.]+/g)?.join("\n"));
assert.equal(new Set(commerceDetailDirectionPairs).size, 15);
assert.equal(buildCommerceDetailSetVariantPrompt(differentStyleEdit, "不同风格", 0, 4), differentStyleEdit);

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
