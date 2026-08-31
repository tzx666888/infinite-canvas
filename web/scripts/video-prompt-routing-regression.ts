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
assert.match(shortCommerceCompiled, /EXACT VISUAL HOOK OVERRIDE — HIGHEST VISUAL PRIORITY/);
assert.match(shortCommerceCompiled, /FIRST-FRAME LOCK/);
assert.match(shortCommerceCompiled, /presenter merely entering frame or saying/);
assert.ok(shortCommerceCompiled.indexOf("EXACT VISUAL HOOK OVERRIDE") < shortCommerceCompiled.indexOf("USER DIRECTION"), "the executable visual hook must precede the generic short direction");
assert.match(shortCommerceCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-3s/);
assert.match(shortCommerceCompiled, /follow the earlier randomly selected EXACT VISUAL HOOK OVERRIDE/);
assert.match(shortCommerceCompiled, /physical surprise must begin by 0\.65s/);
assert.match(shortCommerceCompiled, /DO NOT count as a hook/);
assert.match(shortCommerceCompiled, /3-8s/);
assert.match(shortCommerceCompiled, /8-10s/);
assert.match(shortCommerceCompiled, /stay region-neutral/);
assert.doesNotMatch(shortCommerceCompiled, /Indonesian social-commerce|Bahasa Indonesia|Jakarta/);

const shortIndonesiaTenSecondCompiled = buildReferenceVideoPrompt("生成一段印尼带货视频", 1, 1, "10", "auto", "i2v");
assert.match(shortIndonesiaTenSecondCompiled, /EXACT VISUAL HOOK OVERRIDE — HIGHEST VISUAL PRIORITY/);
assert.match(shortIndonesiaTenSecondCompiled, /photoreal live-action documentary style/);
assert.match(shortIndonesiaTenSecondCompiled, /0\.00-0\.65s/);
assert.match(shortIndonesiaTenSecondCompiled, /0\.65-(?:1\.70|2\.20)s/);
assert.match(shortIndonesiaTenSecondCompiled, /(?:1\.70|2\.20)-3\.00s/);
assert.match(shortIndonesiaTenSecondCompiled, /ordinary ongoing action/);
assert.match(shortIndonesiaTenSecondCompiled, /NATURAL CAUSALITY LOCK/);
assert.match(shortIndonesiaTenSecondCompiled, /ordinary action, visible physical trigger, involuntary reaction, then fully motivated recovery/);
assert.match(shortIndonesiaTenSecondCompiled, /HOOK ROTATION LOCK/);
assert.match(shortIndonesiaTenSecondCompiled, /no product is visible|no product before the hard cut/);
assert.match(shortIndonesiaTenSecondCompiled, /At exactly 3\.00s, after the complete hook payoff/);
assert.match(shortIndonesiaTenSecondCompiled, /Reveal the product only after the hard cut/);
assert.match(shortIndonesiaTenSecondCompiled, /visible background gap between their silhouettes/);
assert.match(shortIndonesiaTenSecondCompiled, /RIGID-BODY SEPARATION LOCK — MANDATORY/);
assert.match(shortIndonesiaTenSecondCompiled, /distinct rigid bodies with independent closed contours/);
assert.match(shortIndonesiaTenSecondCompiled, /No product emerges from, grows out of, pops from, or transforms from any package/);
assert.ok(shortIndonesiaTenSecondCompiled.indexOf("RIGID-BODY SEPARATION LOCK") < shortIndonesiaTenSecondCompiled.indexOf("USER DIRECTION"), "product/package separation must be front-loaded before the user direction");
assert.doesNotMatch(shortIndonesiaTenSecondCompiled, /parcel opens and .*product snaps upright|lid snaps open and reveals|box unfolds into .*product|product lands upright/i);
assert.match(shortIndonesiaTenSecondCompiled, /not as a mandatory literal opening frame/);
assert.match(shortIndonesiaTenSecondCompiled, /begin inside an already ongoing, ordinary real-world action at 0\.00s/);
assert.match(shortIndonesiaTenSecondCompiled, /natural cause before the surprise/);
assert.match(shortIndonesiaTenSecondCompiled, /must not start already crouched, falling, recoiling, or posing/);
assert.ok(shortIndonesiaTenSecondCompiled.indexOf("EXACT VISUAL HOOK OVERRIDE") < shortIndonesiaTenSecondCompiled.indexOf("EXACT NARRATION OVERRIDE"), "visual and speech locks must both be front-loaded, with the failing visual hook first");
assert.match(shortIndonesiaTenSecondCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-3s/);
assert.match(shortIndonesiaTenSecondCompiled, /0-1s trigger the expectation break/);
assert.match(shortIndonesiaTenSecondCompiled, /Never show or flash the product before 3s/);
assert.match(shortIndonesiaTenSecondCompiled, /never cut away and back during the incident/);
assert.match(shortIndonesiaTenSecondCompiled, /never begin the product demonstration early, finish the hook early, or hold a static frame before 3s/);
assert.doesNotMatch(shortIndonesiaTenSecondCompiled, /ultra-short macro flashes|product or finished-food hook flash/i);
assert.match(shortIndonesiaTenSecondCompiled, /The user explicitly requested Indonesia/);
assert.match(shortIndonesiaTenSecondCompiled, /Bahasa Indonesia/);
assert.match(shortIndonesiaTenSecondCompiled, /EXACT NARRATION OVERRIDE — HIGHEST PRIORITY/);
assert.match(shortIndonesiaTenSecondCompiled, /Wah, bikin kaget\. Oke, lanjut—lihat yang ini\./);
assert.match(shortIndonesiaTenSecondCompiled, /Do not shorten, paraphrase, translate, reorder, replace, or add any words/);
assert.match(shortIndonesiaTenSecondCompiled, /first audible syllable between 0\.55s and 0\.80s/);
assert.match(shortIndonesiaTenSecondCompiled, /No extra efficacy, durability, safety, price, scarcity, urgency, medical, or sexual-performance claims/);
assert.ok(shortIndonesiaTenSecondCompiled.indexOf("EXACT NARRATION OVERRIDE") < shortIndonesiaTenSecondCompiled.indexOf("USER DIRECTION"), "exact local narration must precede the short user direction and all generic routing");
assert.match(shortIndonesiaTenSecondCompiled, /SPOKEN DELIVERY LOCK — MANDATORY/);
assert.match(shortIndonesiaTenSecondCompiled, /LOCAL SPEECH ROUTING/);
assert.match(shortIndonesiaTenSecondCompiled, /native accent, idiom, sentence length, emphasis, pauses, and short-video speed/);
assert.match(shortIndonesiaTenSecondCompiled, /explicit language overrides the country default/);
assert.match(shortIndonesiaTenSecondCompiled, /write exactly four short sentences/);
assert.match(shortIndonesiaTenSecondCompiled, /22-28 natural target-language word equivalents/);
assert.match(shortIndonesiaTenSecondCompiled, /0-3s hook reaction 4-6 words/);
assert.match(shortIndonesiaTenSecondCompiled, /No silent gap may exceed 0\.35s/);
assert.match(shortIndonesiaTenSecondCompiled, /SHORT-COMMERCE ACCEPTANCE LOCK/);
assert.match(shortIndonesiaTenSecondCompiled, /NARRATION START LOCK/);
assert.ok(shortIndonesiaTenSecondCompiled.indexOf("NARRATION START LOCK") < shortIndonesiaTenSecondCompiled.indexOf("HOOK ACCEPTANCE GATE"), "speech must start inside the hook");
assert.ok(shortIndonesiaTenSecondCompiled.indexOf("HOOK ACCEPTANCE GATE") < shortIndonesiaTenSecondCompiled.indexOf("SPOKEN DELIVERY LOCK"), "full speech plan follows the visible hook while the early narration lock preserves simultaneous delivery");
assert.match(shortIndonesiaTenSecondCompiled, /FACTUAL SCRIPT LOCK/);
assert.match(shortIndonesiaTenSecondCompiled, /Never invent efficacy, results, safety, price, discount, rating, guarantee, limited stock, scarcity, urgency/);
assert.match(shortIndonesiaTenSecondCompiled, /'stok terbatas'/);
assert.match(shortIndonesiaTenSecondCompiled, /talking while normally holding the product is not a hook/);
assert.match(shortIndonesiaTenSecondCompiled, /3-8s/);
assert.match(shortIndonesiaTenSecondCompiled, /8-10s/);

const repeatedIndonesiaHookPrompts = Array.from({ length: 10 }, () => buildReferenceVideoPrompt("生成一段印尼带货视频", 1, 1, "10", "auto", "i2v"));
const exactHookTimelines = repeatedIndonesiaHookPrompts.map((prompt) => prompt.match(/EXACT HOOK TIMELINE: ([\s\S]*?)\nREJECTION LOCK:/)?.[1] || "");
assert.ok(exactHookTimelines.every(Boolean), "every short commerce request must receive an exact executable hook timeline");
for (let index = 1; index < exactHookTimelines.length; index += 1) {
    assert.notEqual(exactHookTimelines[index], exactHookTimelines[index - 1], "repeated generations must not reuse the immediately previous hook");
}
assert.equal(new Set(exactHookTimelines).size, 5, "a shuffle-bag cycle must cover all five natural hook structures");
assert.ok(exactHookTimelines.some((timeline) => /completes one genuine continuous low-energy fall/.test(timeline)), "the fall route must show a complete genuine safe fall");
assert.ok(exactHookTimelines.some((timeline) => /no fake squat/.test(timeline)), "the fall route must explicitly reject a fake squat");
assert.ok(exactHookTimelines.some((timeline) => /visible body-floor contact to the strongest impact beat/.test(timeline)), "the fall route must synchronize the real landing to the impact beat");

const shortIndonesiaFifteenSecondCompiled = buildReferenceVideoPrompt("生成一段印尼带货视频", 1, 1, "15", "auto", "i2v");
assert.match(shortIndonesiaFifteenSecondCompiled, /0\.00-0\.65s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /0\.65-(?:1\.70|2\.20)s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /(?:1\.70|2\.20)-3\.00s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /At exactly 3\.00s, after the complete hook payoff/);
assert.match(shortIndonesiaFifteenSecondCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-3s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /0-1s trigger the expectation break/);
assert.match(shortIndonesiaFifteenSecondCompiled, /1-2s escalate it/);
assert.match(shortIndonesiaFifteenSecondCompiled, /2-3s deliver the incident payoff/);
assert.match(shortIndonesiaFifteenSecondCompiled, /Never show or flash the product before 3s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /never cut away and back during the incident/);
assert.match(shortIndonesiaFifteenSecondCompiled, /never begin the product demonstration early, finish the hook early, or hold a static frame before 3s/);
assert.doesNotMatch(shortIndonesiaFifteenSecondCompiled, /ultra-short macro flashes|product or finished-food hook flash/i);
assert.match(shortIndonesiaFifteenSecondCompiled, /3-12s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /12-15s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /Bahasa Indonesia/);
assert.match(shortIndonesiaFifteenSecondCompiled, /Wah, bikin kaget\. Oke, lanjut—lihat yang satu ini\./);
assert.match(shortIndonesiaFifteenSecondCompiled, /pilih yang paling sesuai untuk kebutuhanmu/);
assert.match(shortIndonesiaFifteenSecondCompiled, /across at least 12\.5 seconds/);
assert.match(shortIndonesiaFifteenSecondCompiled, /38-47 natural target-language word equivalents/);
assert.match(shortIndonesiaFifteenSecondCompiled, /0-3s spoken hook 6-9 words/);
assert.match(shortIndonesiaFifteenSecondCompiled, /No silent gap may exceed 0\.6s/);
assert.match(shortIndonesiaFifteenSecondCompiled, /SHORT-COMMERCE ACCEPTANCE LOCK/);
assert.match(shortIndonesiaFifteenSecondCompiled, /NARRATION START LOCK/);
assert.ok(shortIndonesiaFifteenSecondCompiled.indexOf("NARRATION START LOCK") < shortIndonesiaFifteenSecondCompiled.indexOf("HOOK ACCEPTANCE GATE"), "15-second narration must begin inside the hook");
assert.ok(shortIndonesiaFifteenSecondCompiled.indexOf("HOOK ACCEPTANCE GATE") < shortIndonesiaFifteenSecondCompiled.indexOf("SPOKEN DELIVERY LOCK"), "15-second detailed speech plan follows the hook gate");

const shortJapanCompiled = buildReferenceVideoPrompt("生成一段日本带货视频", 1, 1, "10", "auto", "i2v");
assert.match(shortJapanCompiled, /named market's natural everyday commercial language/);
assert.match(shortJapanCompiled, /native accent, idiom, sentence length, emphasis, pauses, and short-video speed/);
assert.match(shortJapanCompiled, /never translate Chinese phrasing word-for-word/);
assert.doesNotMatch(shortJapanCompiled, /Bahasa Indonesia/);
assert.doesNotMatch(shortJapanCompiled, /EXACT NARRATION OVERRIDE/);

const shortTextOnlyCommerceCompiled = buildReferenceVideoPrompt("帮我生成一条便携榨汁杯的10秒竖屏带货视频，要强Hook，商品全程清晰，结尾有一个明确的下单CTA。", 0, 0, "10", "auto", "t2v");
assert.match(shortTextOnlyCommerceCompiled, /text-to-video commercial/);
assert.match(shortTextOnlyCommerceCompiled, /USER DIRECTION \(SHORT PRIORITY\)/);
assert.match(shortTextOnlyCommerceCompiled, /No reference images are attached/);
assert.match(shortTextOnlyCommerceCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-3s/);
assert.match(shortTextOnlyCommerceCompiled, /stay region-neutral/);
assert.match(shortTextOnlyCommerceCompiled, /With no named market, use the prompt language neutrally/);
assert.ok(shortTextOnlyCommerceCompiled.length > 50, "text-only short commerce prompt must be expanded before the upstream request");

const plainTextOnlyPrompt = "一朵云从山谷上方缓慢飘过";
assert.equal(buildReferenceVideoPrompt(plainTextOnlyPrompt, 0, 0, "10", "auto", "t2v"), plainTextOnlyPrompt, "ordinary text-to-video prompts must not receive commerce routing");
assert.equal(buildReferenceVideoPrompt(detailedProductPrompt, 0, 0, "10", "auto", "t2v"), detailedProductPrompt, "detailed text-only production briefs must remain unchanged");

const explicitMelbourneCompiled = buildReferenceVideoPrompt("生成一条面向澳大利亚墨尔本的 Instagram Reels 带货广告，价格使用澳元", 2, 2, "10", "auto", "r2v");
assert.match(explicitMelbourneCompiled, /USER DIRECTION names a country, city, language, currency, platform/);
assert.match(explicitMelbourneCompiled, /澳大利亚墨尔本/);
assert.match(explicitMelbourneCompiled, /Instagram Reels/);

const mediumCommerceCompiled = buildReferenceVideoPrompt("请制作一条商品带货短片，先用我指定的快速推镜开场，再展示包装正面和一次真实操作，最后停在商品特写。".repeat(5), 2, 2, "10", "auto", "r2v");
assert.match(mediumCommerceCompiled, /USER DIRECTION \(MEDIUM PRIORITY\)/);
assert.match(mediumCommerceCompiled, /preserve the user's existing hook/);
assert.doesNotMatch(mediumCommerceCompiled, /HOOK ACCEPTANCE GATE/);

const shortProductOnlyCompiled = buildReferenceVideoPrompt("不要人物，生成一个带货广告，只展示商品并上下跳动", 2, 2, "10", "auto", "r2v");
assert.match(shortProductOnlyCompiled, /Product-only route/);
assert.match(shortProductOnlyCompiled, /EXACT VISUAL HOOK OVERRIDE/);
assert.match(shortProductOnlyCompiled, /Product-only shot rhythm/);
assert.match(shortProductOnlyCompiled, /HOOK ACCEPTANCE GATE — MANDATORY 0-3s/);
assert.match(shortProductOnlyCompiled, /Use one continuous off-screen narrator only/);
assert.match(shortProductOnlyCompiled, /HARD EDITORIAL CUT/);
assert.match(shortProductOnlyCompiled, /RIGID-BODY SEPARATION LOCK/);
assert.doesNotMatch(shortProductOnlyCompiled, /parcel bursts open|lid snaps open and reveals|box unfolds into/i);
assert.doesNotMatch(shortProductOnlyCompiled, /surreal adult fall|visible natural lip-sync|one consistent presenter|presenter-matched voice/i);

const shortExplicitHookCompiled = buildReferenceVideoPrompt("生成一个带货广告，开头让纸箱从高处掉落并在落地前冻结", 1, 1, "10", "auto", "i2v");
assert.doesNotMatch(shortExplicitHookCompiled, /EXACT VISUAL HOOK OVERRIDE/, "a concrete user-supplied opening must not be replaced by the built-in hook");
assert.match(shortExplicitHookCompiled, /纸箱从高处掉落并在落地前冻结/);

const shortSilentCommerceCompiled = buildReferenceVideoPrompt("生成一个带货广告，不要口播，只要音乐", 1, 1, "10", "auto", "i2v");
assert.match(shortSilentCommerceCompiled, /NO presenter dialogue/);
assert.doesNotMatch(shortSilentCommerceCompiled, /SPOKEN DELIVERY LOCK/);

assert.doesNotMatch(mediumCommerceCompiled, /SPOKEN DELIVERY LOCK/, "medium briefs must not receive mandatory speech density");
assert.doesNotMatch(detailedCompiled, /SPOKEN DELIVERY LOCK/, "detailed briefs must remain user-controlled");

console.log("Video prompt routing regression checks passed");
