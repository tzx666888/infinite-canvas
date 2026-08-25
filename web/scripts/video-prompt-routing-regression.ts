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
assert.match(shortCommerceCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-2s/);
assert.match(shortCommerceCompiled, /near-miss reveal/);
assert.match(shortCommerceCompiled, /safe staged adult stumble or surreal fall/);
assert.match(shortCommerceCompiled, /normal walking/);
assert.match(shortCommerceCompiled, /DO NOT count as a hook/);
assert.match(shortCommerceCompiled, /2-8s/);
assert.match(shortCommerceCompiled, /8-10s/);
assert.match(shortCommerceCompiled, /remain region-neutral/);
assert.doesNotMatch(shortCommerceCompiled, /Indonesian social-commerce|Bahasa Indonesia|Jakarta/);

const shortIndonesiaTenSecondCompiled = buildReferenceVideoPrompt("生成一段印尼带货视频", 1, 1, "10", "auto", "i2v");
assert.match(shortIndonesiaTenSecondCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-2s/);
assert.match(shortIndonesiaTenSecondCompiled, /first 0\.3s/);
assert.match(shortIndonesiaTenSecondCompiled, /0-0\.7s trigger the expectation break/);
assert.match(shortIndonesiaTenSecondCompiled, /Never finish the hook early and hold a static frame before 2s/);
assert.match(shortIndonesiaTenSecondCompiled, /The user explicitly requested Indonesia/);
assert.match(shortIndonesiaTenSecondCompiled, /Bahasa Indonesia/);
assert.match(shortIndonesiaTenSecondCompiled, /2-8s/);
assert.match(shortIndonesiaTenSecondCompiled, /8-10s/);

const shortIndonesiaFifteenSecondCompiled = buildReferenceVideoPrompt("生成一段印尼带货视频", 1, 1, "15", "auto", "i2v");
assert.match(shortIndonesiaFifteenSecondCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-3s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /0-1s trigger the expectation break/);
assert.match(shortIndonesiaFifteenSecondCompiled, /1-2s escalate it/);
assert.match(shortIndonesiaFifteenSecondCompiled, /2-3s deliver the payoff/);
assert.match(shortIndonesiaFifteenSecondCompiled, /Never finish the hook early and hold a static frame before 3s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /3-12s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /12-15s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /Bahasa Indonesia/);

const shortTextOnlyCommerceCompiled = buildReferenceVideoPrompt("帮我生成一条便携榨汁杯的10秒竖屏带货视频，要强Hook，商品全程清晰，结尾有一个明确的下单CTA。", 0, 0, "10", "auto", "t2v");
assert.match(shortTextOnlyCommerceCompiled, /text-to-video commercial/);
assert.match(shortTextOnlyCommerceCompiled, /USER DIRECTION \(SHORT PRIORITY\)/);
assert.match(shortTextOnlyCommerceCompiled, /No reference images are attached/);
assert.match(shortTextOnlyCommerceCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-2s/);
assert.match(shortTextOnlyCommerceCompiled, /remain region-neutral/);
assert.ok(shortTextOnlyCommerceCompiled.length > 50, "text-only short commerce prompt must be expanded before the upstream request");

const plainTextOnlyPrompt = "一朵云从山谷上方缓慢飘过";
assert.equal(buildReferenceVideoPrompt(plainTextOnlyPrompt, 0, 0, "10", "auto", "t2v"), plainTextOnlyPrompt, "ordinary text-to-video prompts must not receive commerce routing");
assert.equal(buildReferenceVideoPrompt(detailedProductPrompt, 0, 0, "10", "auto", "t2v"), detailedProductPrompt, "detailed text-only production briefs must remain unchanged");

const explicitMelbourneCompiled = buildReferenceVideoPrompt("生成一条面向澳大利亚墨尔本的 Instagram Reels 带货广告，价格使用澳元", 2, 2, "10", "auto", "r2v");
assert.match(explicitMelbourneCompiled, /explicitly names a country, city, language, currency, platform/);
assert.match(explicitMelbourneCompiled, /澳大利亚墨尔本/);
assert.match(explicitMelbourneCompiled, /Instagram Reels/);

const mediumCommerceCompiled = buildReferenceVideoPrompt("请制作一条商品带货短片，先用我指定的快速推镜开场，再展示包装正面和一次真实操作，最后停在商品特写。".repeat(5), 2, 2, "10", "auto", "r2v");
assert.match(mediumCommerceCompiled, /USER DIRECTION \(MEDIUM PRIORITY\)/);
assert.match(mediumCommerceCompiled, /preserve the user's existing hook/);
assert.doesNotMatch(mediumCommerceCompiled, /HOOK ACCEPTANCE GATE/);

const shortProductOnlyCompiled = buildReferenceVideoPrompt("不要人物，生成一个带货广告，只展示商品并上下跳动", 2, 2, "10", "auto", "r2v");
assert.match(shortProductOnlyCompiled, /Product-only route/);
assert.match(shortProductOnlyCompiled, /burst-to-reveal, scale contrast, spatial mismatch/);
assert.match(shortProductOnlyCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-2s/);
assert.doesNotMatch(shortProductOnlyCompiled, /surreal adult fall|visible natural lip-sync|one consistent presenter|presenter-matched voice/i);

console.log("Video prompt routing regression checks passed");
