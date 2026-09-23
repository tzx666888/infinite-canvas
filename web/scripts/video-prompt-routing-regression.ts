import assert from "node:assert/strict";

import { classifyVideoPromptDetail } from "../src/lib/video-prompt-policy.ts";
import { buildReferenceVideoPrompt } from "../src/services/api/video.ts";

const completeBrief = `9:16, total 10 seconds. 0-2s black screen with a supplied title. 2-7s the referenced product moves into frame without rotation. 7-10s hold the same product front-facing. No people, smoke, or invented text. ${"Keep the supplied product geometry, markings, colors, and count exactly unchanged. ".repeat(7)}`;
assert.equal(classifyVideoPromptDetail("生成一个带货广告"), "short");
assert.equal(classifyVideoPromptDetail(completeBrief), "detailed");
assert.equal(buildReferenceVideoPrompt(completeBrief, 1, 1, "10", "auto", "i2v"), completeBrief.trim());

const shortWithProduct = buildReferenceVideoPrompt("生成一个带货广告", 1, 1, "10", "auto", "r2v");
assert.match(shortWithProduct, /0-2s:.*actual product/i);
assert.match(shortWithProduct, /2-8s: continue the same action/i);
assert.match(shortWithProduct, /product may appear from the first frame/i);
assert.doesNotMatch(shortWithProduct, /carton stack|trolley|paper cup|EXACT VISUAL HOOK OVERRIDE/i);
assert.ok(shortWithProduct.length < 1800, "short commerce direction should stay usable by the video model");

const h3FifteenSeconds = buildReferenceVideoPrompt("生成一条商品带货视频", 2, 2, "15", "auto", "r2v");
assert.match(h3FifteenSeconds, /0-3s:/);
assert.match(h3FifteenSeconds, /3-12s:/);
assert.match(h3FifteenSeconds, /12-15s:/);
assert.match(h3FifteenSeconds, /all 2 attached images/i);

const textOnly = buildReferenceVideoPrompt("生成一条便携榨汁杯的带货视频", 0, 0, "10", "auto", "t2v");
assert.match(textOnly, /actual product/i);
assert.match(textOnly, /only the product and context stated by the user/i);
assert.doesNotMatch(textOnly, /carton stack|trolley|paper cup/i);

const productOnly = buildReferenceVideoPrompt("不要人物和口播，只展示商品，生成带货视频", 1, 1, "10", "auto", "r2v");
assert.match(productOnly, /NO people/i);
assert.match(productOnly, /NO presenter dialogue/i);
assert.match(productOnly, /Keep people, hands, and body parts out/i);
assert.doesNotMatch(productOnly, /one short natural line/i);

const requestedOpening = buildReferenceVideoPrompt("生成带货视频，开头让纸箱从高处掉落并在落地前冻结", 1, 1, "10", "auto", "r2v");
assert.match(requestedOpening, /纸箱从高处掉落并在落地前冻结/);
assert.match(requestedOpening, /Use the user's stated opening action/i);
assert.doesNotMatch(requestedOpening, /randomly selected|carton stack/i);

const requestedStrongHook = buildReferenceVideoPrompt("生成一条带货视频，要强 Hook", 1, 1, "10", "auto", "r2v", "commerce");
assert.match(requestedStrongHook, /visually distinctive/i);
assert.doesNotMatch(requestedStrongHook, /trolley|paper cup|fall onto/i);

const ordinary = "一朵云从山谷上方缓慢飘过";
assert.equal(buildReferenceVideoPrompt(ordinary, 0, 0, "10", "auto", "t2v"), ordinary);

console.log("Video prompt routing regression checks passed");
