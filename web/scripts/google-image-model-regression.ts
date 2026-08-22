import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    buildTokaxisGoogleImageChatRequest,
    GENERIC_IMAGE_MAX_EDGE,
    GENERIC_IMAGE_MAX_RATIO,
    GENERIC_IMAGE_MIN_PIXELS,
    GPT_IMAGE_2_MAX_PIXELS,
    imageMaxPixelsForSelectedModel,
    isTokaxisGoogleImageModel,
    normalizeImageSizeForSelectedModel,
    resolveTokaxisGoogleImageConfig,
    TOKAXIS_GOOGLE_IMAGE_BASE_MODEL,
    TOKAXIS_GOOGLE_IMAGE_MODELS,
    TOKAXIS_GOOGLE_IMAGE_SIZES,
    TOKAXIS_GOOGLE_NATIVE_SIZES,
    tokaxisGoogleModelForSize,
} from "../src/lib/tokaxis-google-image.ts";
import { normalizeImageQualityForModel } from "../src/lib/image-quality.ts";

assert.equal(Object.keys(TOKAXIS_GOOGLE_NATIVE_SIZES).length, 15, "Google 模型必须保留当前 15 种比例（含 2:1 全景）");
assert.equal(TOKAXIS_GOOGLE_NATIVE_SIZES["2:1"]["4K"], "6144x3072", "2:1 全景必须映射到原生 4K 尺寸");
assert.deepEqual(TOKAXIS_GOOGLE_IMAGE_SIZES, ["4K"]);

for (const imageSize of TOKAXIS_GOOGLE_IMAGE_SIZES) {
    const model = TOKAXIS_GOOGLE_IMAGE_MODELS[imageSize];
    assert.equal(isTokaxisGoogleImageModel(model), true);
    assert.equal(resolveTokaxisGoogleImageConfig(model, "16:9", "low").image_size, "4K", "公开 Google 生图模型必须固定为 4K");
}

assert.equal(isTokaxisGoogleImageModel(`${TOKAXIS_GOOGLE_IMAGE_BASE_MODEL}-1k`), true, "旧 1K ID 必须只用于历史配置迁移");
assert.equal(isTokaxisGoogleImageModel(`${TOKAXIS_GOOGLE_IMAGE_BASE_MODEL}-2k`), true, "旧 2K ID 必须只用于历史配置迁移");
assert.equal(resolveTokaxisGoogleImageConfig(TOKAXIS_GOOGLE_IMAGE_BASE_MODEL, "1024x1024").image_size, "4K");
assert.equal(resolveTokaxisGoogleImageConfig(TOKAXIS_GOOGLE_IMAGE_BASE_MODEL, "2752x1536").image_size, "4K");
assert.deepEqual(resolveTokaxisGoogleImageConfig(TOKAXIS_GOOGLE_IMAGE_BASE_MODEL, "5504x3072"), {
    aspect_ratio: "16:9",
    image_size: "4K",
});
assert.equal(tokaxisGoogleModelForSize("tokaxis::gemini-3.1-flash-image-1k", "4K"), "tokaxis::gemini-3.1-flash-image-4k");
assert.equal(tokaxisGoogleModelForSize("tokaxis::gemini-3.1-flash-image-2k", "4K"), "tokaxis::gemini-3.1-flash-image-4k");
assert.deepEqual(
    buildTokaxisGoogleImageChatRequest({
        model: "gemini-3.1-flash-image-1k",
        messages: [{ role: "user", content: "legacy canvas node" }],
        imageConfig: resolveTokaxisGoogleImageConfig("gemini-3.1-flash-image-1k", "1:1", "low"),
    }),
    {
        model: "gemini-3.1-flash-image-4k",
        messages: [{ role: "user", content: "legacy canvas node" }],
        stream: false,
        image_config: { aspect_ratio: "1:1", image_size: "4K" },
    },
    "旧画布节点提交前必须同时迁移模型 ID 与 image_size",
);

assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gemini-3.1-flash-image-4k", "5504x3072"), "5504x3072", "Google 4K 必须保留原生尺寸");
assert.equal(GPT_IMAGE_2_MAX_PIXELS, 8_294_400, "GPT Image 2 必须使用上游的 4K UHD 总像素上限");
assert.equal(imageMaxPixelsForSelectedModel("tokaxis::gpt-image-2"), GPT_IMAGE_2_MAX_PIXELS);
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "5056x3392"), "3520x2352", "切换到 GPT Image 2 应保留比例并遵守总像素上限");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "3840x2576"), "3520x2352", "旧画布中已保存的超限尺寸必须自动修复");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "4096x4096"), "2880x2880", "方形 Google 4K 应按 GPT Image 2 总像素上限收缩");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "4800x3584"), "3328x2480", "4:3 收缩后不得因 16 像素对齐再次超限");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::grok-imagine-image-lite", "4096x4096"), "3840x3840", "其他生图模型不应被 GPT Image 2 上限降级");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "1:8"), "auto", "GPT Image 2 不应继承 Google 超宽比");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "2048x2048"), "2048x2048", "已合法的尺寸不应改动");
assert.equal(normalizeImageQualityForModel("standard", "tokaxis::gpt-image-2"), "low", "旧画布的 standard 质量必须映射到 GPT Image 2 支持的 low");
assert.equal(normalizeImageQualityForModel("hd", "gpt-image-2"), "high", "旧画布的 hd 质量必须映射到 GPT Image 2 支持的 high");
assert.equal(normalizeImageQualityForModel("standard", "dall-e-3"), "standard", "其他模型仍需保留各自支持的 standard 质量");
assert.equal(normalizeImageQualityForModel("4K", "gpt-image-2"), "high", "分辨率质量别名必须继续兼容");

for (const [aspectRatio, sizes] of Object.entries(TOKAXIS_GOOGLE_NATIVE_SIZES)) {
    const [ratioWidth, ratioHeight] = aspectRatio.split(":").map(Number);
    const normalized = normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", sizes["4K"]);
    if (Math.max(ratioWidth, ratioHeight) / Math.min(ratioWidth, ratioHeight) > GENERIC_IMAGE_MAX_RATIO) {
        assert.equal(normalized, "auto", `${aspectRatio} 超宽比必须降级为 auto`);
        continue;
    }
    const match = normalized.match(/^(\d+)x(\d+)$/);
    assert.ok(match, `${aspectRatio} 必须归一化为明确像素尺寸`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    assert.equal(width % 16, 0, `${aspectRatio} 宽度必须为 16 的倍数`);
    assert.equal(height % 16, 0, `${aspectRatio} 高度必须为 16 的倍数`);
    assert.ok(Math.max(width, height) <= GENERIC_IMAGE_MAX_EDGE, `${aspectRatio} 最长边不得超限`);
    assert.ok(width * height >= GENERIC_IMAGE_MIN_PIXELS, `${aspectRatio} 总像素不得低于下限`);
    assert.ok(width * height <= GPT_IMAGE_2_MAX_PIXELS, `${aspectRatio} 总像素不得超过 GPT Image 2 上限`);
    assert.ok(Math.max(width, height) / Math.min(width, height) <= GENERIC_IMAGE_MAX_RATIO, `${aspectRatio} 归一化后宽高比不得超限`);
}

const imageServiceSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const settingsPanelSource = readFileSync(new URL("../src/components/image-settings-panel.tsx", import.meta.url), "utf8");
const canvasClientSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
assert.match(imageServiceSource, /isGptImageModel\(requestModel\) \? \{\} : \{ response_format: "b64_json" \}/, "GPT Image requests must omit the removed response_format field for JSON generation requests");
assert.match(imageServiceSource, /if \(!isGptImageModel\(requestModel\)\) \{\s*formData\.set\("response_format", "b64_json"\);/, "GPT Image edit requests must omit the removed response_format multipart field");
assert.match(imageServiceSource, /supportsGptImageInputFidelity\(requestModel\)/, "GPT Image edit requests must gate input_fidelity by model support");
assert.match(imageServiceSource, /!\/\^gpt-image-2/, "GPT Image 2 requests must omit the unsupported input_fidelity field");
assert.doesNotMatch(settingsSource, /TOKAXIS_GOOGLE_IMAGE_MODELS\["(?:1K|2K)"\]/, "settings API must not expose retired Google image aliases");
assert.doesNotMatch(configStoreSource, /TOKAXIS_GOOGLE_IMAGE_MODELS\["(?:1K|2K)"\]/, "model sync must not expose retired Google image aliases");
assert.match(configStoreSource, /TOKAXIS_DEFAULTS_VERSION = 24/, "saved model lists must migrate to the current public model contract");
assert.match(configStoreSource, /TOKAXIS_DEFAULT_SELECTIONS_VERSION = 24/, "saved model selections must migrate to the current 4K and Agent defaults");
assert.match(settingsPanelSource, /usesNativeGoogleSizes \? resolutionOptions\.filter\(\(item\) => item\.value === "4k"\)/, "Google image settings must show only the 4K resolution choice");
assert.match(canvasClientSource, /VIDEO_BRIDGE_FALLBACK_IMAGE_MODELS = \["gemini-3\.1-flash-image-4k", "gpt-image-2"\]/, "video bridge fallback must never request retired Google image aliases");

console.log("Google image model contract passed: 4K-only public model, legacy migration, 15 native ratios including 2:1.");
