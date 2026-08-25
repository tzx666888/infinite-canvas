import assert from "node:assert/strict";

import { buildReferenceVideoPrompt, classifyVideoPromptDetail } from "../src/services/api/video.ts";

const detailedProductPrompt = `不要出现人物，Dual image reference: follow the poster reference for neon-pink Melbourne night-city background, glowing circular platform and commercial ad atmosphere; strictly follow multi-view product sheet for BIMO-ONE Skittle device front-face shape, logo graphic and print details. Keep product facing camera FRONT-ONLY, NO rotation, NO turning around, NO showing back side of device, avoid logo distortion and product deformation.

9:16 vertical Instagram Reels commercial advertisement, total 10 seconds.

0-2s reverse hook: total black screen, bold neon-pink text "You won't believe this price" pops and bounces with snappy rhythm, powerful scroll-stop hook.

2-4s: pink BIMO-ONE product bounces and pops into center frame from darkness, elastic bounce landing on glowing neon platform, neon light flashes on instantly, background is modern Melbourne city night skyline, all-English neon signs, zero Chinese or foreign characters.

4-7s: product keeps facing camera front-only, lively cartoon-style small bounces up and down, tiny side-to-side elastic jiggles, soft elastic scale pulse, NO spinning or rotation. Colourful glossy fruit splash bits burst rhythmically following bounce beats, pink-purple fruit burst effect, fresh shiny look, no pill-shaped objects. Wet reflective ground, neon pink rim lighting.

7-10s: product makes one final sharp bounce then freeze frame. Animated text pop-up: "Same-Day Delivery In Melbourne", "Now $59 (Was $79)", glowing neon-pink "Order Now" CTA button bounces onto screen.

Absolutely NO smoke, vapour, mist, fog of any kind. No human beings, no hands, no inhaling action, no mouth close-up. Pure e-commerce product showcase. Do NOT generate WhatsApp icon or WhatsApp text inside video.`;

assert.equal(classifyVideoPromptDetail("产品跳动出场"), "short");
assert.equal(classifyVideoPromptDetail("一段完整但没有时间轴的商品视频说明。".repeat(12)), "medium");
assert.equal(classifyVideoPromptDetail(detailedProductPrompt), "detailed");

const detailedCompiled = buildReferenceVideoPrompt(detailedProductPrompt, 2, 2, "10", "auto", "r2v");
assert.ok(detailedCompiled.length <= 3600, `detailed prompt must fit the provider limit, got ${detailedCompiled.length}`);
assert.match(detailedCompiled, /USER DIRECTION \(DETAILED PRIORITY\)/);
assert.match(detailedCompiled, /Do NOT generate WhatsApp icon or WhatsApp text inside video\./);
assert.match(detailedCompiled, /NO people, humans, presenters/);
assert.match(detailedCompiled, /NO smoke, vapor, vapour, mist, fog/);
assert.match(detailedCompiled, /Keep the product FRONT-ONLY/);
assert.match(detailedCompiled, /NO product rotation/);
assert.doesNotMatch(detailedCompiled, /mini-drama hook|visible natural lip-sync|one consistent presenter|presenter-matched voice/i);

const shortCommerceCompiled = buildReferenceVideoPrompt("生成一个带货广告", 2, 2, "10", "auto", "r2v");
assert.match(shortCommerceCompiled, /USER DIRECTION \(SHORT PRIORITY\)/);
assert.match(shortCommerceCompiled, /mini-drama hook/);

const shortProductOnlyCompiled = buildReferenceVideoPrompt("不要人物，只展示商品并上下跳动", 2, 2, "10", "auto", "r2v");
assert.match(shortProductOnlyCompiled, /Product-only route/);
assert.doesNotMatch(shortProductOnlyCompiled, /mini-drama hook|visible natural lip-sync|one consistent presenter|presenter-matched voice/i);

console.log("Video prompt routing regression checks passed");
