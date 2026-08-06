import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
    AGENT_VIDEO_CREATOR_FIRST_LINE,
    AGENT_VIDEO_DERIVED_MARKET_CORPUS,
    AGENT_VIDEO_MARKETS,
    AGENT_VIDEO_PRESETS,
    AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL,
    AGENT_VIDEO_REFERENCE_ONLY_RULE,
    AGENT_VIDEO_SOURCE_CORPUS,
    AGENT_VIDEO_VISUAL_ONLY_RULE,
    type AgentVideoMarket,
} from "../src/app/(user)/canvas/utils/agent-video-presets.ts";
import { compileAgentVideoPrompt, validateAgentVideoPrompt } from "../src/app/(user)/canvas/utils/agent-video-sop.ts";
import { defaultConfig } from "../src/stores/use-config-store.ts";

const sourceCorpusHashes = {
    phPackageV1: "669e0956948181e73ed1abb33ad31c799c1a86253c877e063426ea4c282d70cc",
    phHandsfree: "02ea5f24d4c29a351ed1c66510169c01ad6a481dd09bae32525b6424203c2578",
    phCreator: "2e6d9e4f1af20112ab90c8a9d7d0c6c8679bdfbe7a4bc7e3497d4afb1c4ff490",
    phPackageV2: "0ee0a186bf8efa6bf640e0fabd50966fcc9664f99bf28a15b7fbc2a100c4e010",
    myCreator: "ca1f37247e6ac05895a5c7455c937ef7e915463b932db708a5ce49d5c485fa6f",
} as const;

assert.deepEqual(Object.keys(AGENT_VIDEO_SOURCE_CORPUS), Object.keys(sourceCorpusHashes), "derived corpora must not enter AGENT_VIDEO_SOURCE_CORPUS");
for (const [key, expected] of Object.entries(sourceCorpusHashes)) {
    assert.equal(
        createHash("sha256")
            .update(AGENT_VIDEO_SOURCE_CORPUS[key as keyof typeof AGENT_VIDEO_SOURCE_CORPUS])
            .digest("hex"),
        expected,
        `${key} must remain byte-identical`,
    );
}

const marketOrder = Object.keys(AGENT_VIDEO_MARKETS);
assert.deepEqual(marketOrder, ["ph", "my", "id", "th", "vn", "cn", "us", "uk", "sg", "jp", "kr", "sa", "br", "mx"]);
assert.ok(["ph", "my", "id", "th", "vn", "cn"].every((market) => AGENT_VIDEO_MARKETS[market as AgentVideoMarket].enabled));
assert.ok(["us", "uk", "sg", "jp", "kr", "sa", "br", "mx"].every((market) => !AGENT_VIDEO_MARKETS[market as AgentVideoMarket].enabled));
assert.equal(AGENT_VIDEO_MARKETS.ph.corpusOrigin, "xinge-original");
assert.equal(AGENT_VIDEO_MARKETS.my.corpusOrigin, "xinge-original");
assert.ok(["id", "th", "vn", "cn"].every((market) => AGENT_VIDEO_MARKETS[market as AgentVideoMarket].corpusOrigin === "derived-pending-review"));
assert.equal(AGENT_VIDEO_MARKETS.cn.platform, "抖音 / 快手");
assert.equal(AGENT_VIDEO_MARKETS.cn.script, "cjk");
assert.equal(AGENT_VIDEO_MARKETS.th.script, "thai");
assert.ok(Object.values(AGENT_VIDEO_DERIVED_MARKET_CORPUS).every(Boolean));

const voices: Record<"ph" | "my" | "id" | "th" | "vn" | "cn", string> = {
    ph: "Ayos... talaga",
    my: "Memang senang... guna selalu",
    id: "Mudah dipakai... cocok banget",
    th: "ใช้ง่ายมาก...ชอบเลย",
    vn: "Dễ dùng thật... tiện lắm",
    cn: "上手很顺...真省心",
};

const scenes: Record<keyof typeof voices, string> = {
    ph: "菲律宾 condo 厨房",
    my: "马来西亚 condo dapur",
    id: "印度尼西亚 kos dapur",
    th: "泰国公寓小厨房",
    vn: "越南 căn hộ bếp",
    cn: "中国出租屋开放式厨房",
};

function handsfreePrompt(market: keyof typeof voices, voice = voices[market], scene = scenes[market]) {
    const shots = Array.from({ length: 3 }, (_, index) => {
        const ending = index === 2 ? "完整结果清楚展示，双手轻敲表达满意并自然指向产品完成 CTA。" : "持续展示真实物理反馈。";
        return `【转场手法：双手自然遮挡切换】【ASMR音效：产品轻触声】${scene}内，双手在操作区域真实拿取并使用产品，保持参考图可见外观、材质、结构和比例，动作符合重力。${ending}口播：“${voice}”`;
    });
    return [`双手与操作区域保持清晰，${AGENT_VIDEO_REFERENCE_ONLY_RULE}`, ...shots, AGENT_VIDEO_VISUAL_ONLY_RULE, AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL].join("\n");
}

for (const market of Object.keys(voices) as Array<keyof typeof voices>) {
    assert.deepEqual(validateAgentVideoPrompt(handsfreePrompt(market), { preset: AGENT_VIDEO_PRESETS.handsfree, market, durationSeconds: 10 }).errors, [], `${market} handsfree fixture`);
}

function handsfreePromptAtLength(length: number) {
    const shots = Array.from({ length: 5 }, (_, index) => {
        const ending = index === 4 ? "完整结果清楚展示，双手轻敲表达满意并自然指向产品完成 CTA。" : "持续展示真实物理反馈。";
        return `【转场手法：双手自然遮挡切换】【ASMR音效：产品轻触声】菲律宾 condo 厨房内，双手真实拿取并使用产品，保持参考图可见外观、材质、结构和比例。${ending}口播：“${voices.ph}”`;
    });
    const head = [`双手与操作区域保持清晰，${AGENT_VIDEO_REFERENCE_ONLY_RULE}`, ...shots].join("\n");
    const suffix = `\n${AGENT_VIDEO_VISUAL_ONLY_RULE}\n${AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL}`;
    const fillerLength = length - head.length - suffix.length - 1;
    assert.ok(fillerLength >= 0);
    return `${head}\n${"真".repeat(fillerLength)}${suffix}`;
}

const prompt1100 = handsfreePromptAtLength(1100);
const result1100 = validateAgentVideoPrompt(prompt1100, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "ph", durationSeconds: 15 });
assert.deepEqual(result1100.errors, []);
assert.equal(result1100.warnings[0]?.code, "prompt_length_outside_target");
const result2500 = validateAgentVideoPrompt(handsfreePromptAtLength(2500), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "ph", durationSeconds: 15 });
assert.match(result2500.errors.join("；"), /超过 2400/);

const creatorScenes = ["condo", "厨房", "居家工作区", "客厅", "餐桌"];
const creatorRanges = ["0-3", "3-6", "6-9", "9-12", "12-15"];
function creatorPrompt(durationFirst: boolean) {
    const shots = creatorScenes.map((scene, index) => {
        const time = `【时长：${creatorRanges[index]}秒】`;
        const transition = "【转场手法：跟随达人自然移动】【ASMR音效：产品轻触声】";
        const ending = index === 4 ? "完整结果清楚展示，达人微笑点头表达满意并自然指向产品完成 CTA。" : "真实物理反馈清晰可见。";
        return `${durationFirst ? `${time}${transition}` : `${transition}${time}`}同一达人和同一产品在${scene}连续真实使用，${ending}口播：“${voices.ph}”`;
    });
    return [AGENT_VIDEO_CREATOR_FIRST_LINE, `同一达人全程保持面容、发型与人物一致。图二产品参考图约束：${AGENT_VIDEO_REFERENCE_ONLY_RULE}`, ...shots, AGENT_VIDEO_VISUAL_ONLY_RULE, AGENT_VIDEO_PRODUCT_CONSISTENCY_TAIL].join("\n");
}
assert.deepEqual(validateAgentVideoPrompt(creatorPrompt(true), { preset: AGENT_VIDEO_PRESETS.creator, market: "ph", durationSeconds: 15 }).errors, []);
assert.match(validateAgentVideoPrompt(creatorPrompt(false), { preset: AGENT_VIDEO_PRESETS.creator, market: "ph", durationSeconds: 15 }).errors.join("；"), /时长前置格式/);

const shortChinese = validateAgentVideoPrompt(handsfreePrompt("cn", "好...用"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 });
assert.match(shortChinese.errors.join("；"), /4–16 字/);
const longChinese = validateAgentVideoPrompt(handsfreePrompt("cn", "这个产品今天用起来真的特别方便顺手...你也试试"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 });
assert.match(longChinese.errors.join("；"), /4–16 字/);
const shortThai = validateAgentVideoPrompt(handsfreePrompt("th", "ดี..."), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "th", durationSeconds: 10 });
assert.match(shortThai.errors.join("；"), /4–24 个泰文字符/);
const oneWordLatin = validateAgentVideoPrompt(handsfreePrompt("ph", "Ayos..."), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "ph", durationSeconds: 10 });
assert.match(oneWordLatin.errors.join("；"), /2–8 词/);

assert.match(validateAgentVideoPrompt(handsfreePrompt("cn").replace("中国出租屋开放式厨房", "TikTok studio"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 }).errors.join("；"), /TikTok/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("cn").replace("真实拿取", "神器永久根治问题并真实拿取"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 }).errors.join("；"), /广告法/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("cn", voices.cn, "海外摄影棚"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "cn", durationSeconds: 10 }).errors.join("；"), /中国真实生活场景/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("id", "Diskon besar... beli sekarang"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "id", durationSeconds: 10 }).errors.join("；"), /价格或促销/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("th", "โปรโมชั่น...ใช้ง่าย"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "th", durationSeconds: 10 }).errors.join("；"), /价格或促销/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("vn", "Giá tốt... dùng ngay"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "vn", durationSeconds: 10 }).errors.join("；"), /价格或促销/);
assert.doesNotMatch(validateAgentVideoPrompt(handsfreePrompt("vn", "Cảm giác... tiện thật"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "vn", durationSeconds: 10 }).errors.join("；"), /价格或促销/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("th").replace("真实拿取", "打折并真实拿取"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "th", durationSeconds: 10 }).errors.join("；"), /价格或促销/);
assert.match(validateAgentVideoPrompt(handsfreePrompt("th").replace("真实拿取", "第一并真实拿取"), { preset: AGENT_VIDEO_PRESETS.handsfree, market: "th", durationSeconds: 10 }).errors.join("；"), /价格或促销/);

const indonesiaOnlyCta = handsfreePrompt("id", "Coba lihat...").replace("指向产品完成 CTA", "展示产品");
assert.doesNotMatch(validateAgentVideoPrompt(indonesiaOnlyCta, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "id", durationSeconds: 10 }).errors.join("；"), /自然口语 CTA/);
assert.match(validateAgentVideoPrompt(indonesiaOnlyCta, { preset: AGENT_VIDEO_PRESETS.handsfree, market: "ph", durationSeconds: 10 }).errors.join("；"), /自然口语 CTA/);

const config = {
    ...defaultConfig,
    baseUrl: "https://example.test/api/tokaxis",
    apiKey: "test-key",
    model: "tokaxis::omni_portrait",
    videoModel: "tokaxis::omni_portrait",
    videoSeconds: "10",
    vquality: "720p",
    size: "720x1280",
    videoModels: ["tokaxis::omni_portrait"],
    models: ["tokaxis::omni_portrait"],
    channels: defaultConfig.channels.map((channel) => ({ ...channel, baseUrl: "https://example.test/api/tokaxis", apiKey: "test-key" })),
};
const product = { dataUrl: "data:image/png;base64,AA==", label: "产品参考图" };
const compilerSystems: string[] = [];
globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const system = body.messages[0].content;
    compilerSystems.push(system);
    const market = (Object.keys(voices) as Array<keyof typeof voices>).find((id) => system.includes(`当前市场是 ${AGENT_VIDEO_MARKETS[id].label}`));
    assert.ok(market, "compiler system must identify a P0 market");
    return new Response(JSON.stringify({ choices: [{ message: { content: `[Video Prompt]\n${handsfreePrompt(market)}` } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

for (const market of Object.keys(voices) as Array<keyof typeof voices>) {
    await compileAgentVideoPrompt({ config, preset: AGENT_VIDEO_PRESETS.handsfree, market, model: "tokaxis::omni_portrait", size: "720x1280", referenceImages: [product], userIntent: "真实展示产品" });
}
const systemsByMarket = Object.fromEntries((Object.keys(voices) as Array<keyof typeof voices>).map((market, index) => [market, compilerSystems[index]]));
assert.match(systemsByMarket.cn, /待鑫哥复核，不属于鑫哥原文/);
assert.match(systemsByMarket.cn, /引号内为 4–16 个简体中文汉字/);
assert.match(systemsByMarket.cn, /中国市场只使用抖音 \/ 快手语境/);
assert.match(systemsByMarket.th, /引号内为 4–24 个泰文字符/);
assert.match(systemsByMarket.ph, /当前市场语料来自鑫哥原始语料/);
assert.match(systemsByMarket.my, /当前市场语料来自鑫哥原始语料/);
assert.match(systemsByMarket.ph, /引号内只有 2–8 个当地语言词/);

console.log(
    JSON.stringify(
        {
            sourceCorpusHashes: "5/5 unchanged",
            marketOrder,
            enabledP0: ["ph", "my", "id", "th", "vn", "cn"],
            disabledP1P2: ["us", "uk", "sg", "jp", "kr", "sa", "br", "mx"],
            scriptValidation: { latin: "2-8 words", cjk: "4-16 Han characters", thai: "4-24 Thai characters" },
            chinaContext: "Douyin / Kuaishou; TikTok and advertising-law blocked terms rejected",
            corpusOrigin: "ph/my original; id/th/vn/cn derived-pending-review",
            m2Regression: { exact1100: result1100, exact2500: result2500, creatorDurationPrefix: "new passes; old fails" },
            compilerMarkets: Object.keys(systemsByMarket),
            status: "PASS",
        },
        null,
        2,
    ),
);
