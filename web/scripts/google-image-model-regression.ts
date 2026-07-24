import assert from "node:assert/strict";

import {
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

assert.equal(Object.keys(TOKAXIS_GOOGLE_NATIVE_SIZES).length, 14, "Google 模型必须保留官方 14 种比例");
assert.deepEqual(TOKAXIS_GOOGLE_IMAGE_SIZES, ["1K", "2K", "4K"]);

for (const imageSize of TOKAXIS_GOOGLE_IMAGE_SIZES) {
    const model = TOKAXIS_GOOGLE_IMAGE_MODELS[imageSize];
    assert.equal(isTokaxisGoogleImageModel(model), true);
    assert.equal(resolveTokaxisGoogleImageConfig(model, "16:9", "low").image_size, imageSize, "模型名后缀必须优先决定档位");
}

assert.equal(resolveTokaxisGoogleImageConfig(TOKAXIS_GOOGLE_IMAGE_BASE_MODEL, "1024x1024").image_size, "1K");
assert.equal(resolveTokaxisGoogleImageConfig(TOKAXIS_GOOGLE_IMAGE_BASE_MODEL, "2752x1536").image_size, "2K");
assert.deepEqual(resolveTokaxisGoogleImageConfig(TOKAXIS_GOOGLE_IMAGE_BASE_MODEL, "5504x3072"), {
    aspect_ratio: "16:9",
    image_size: "4K",
});
assert.equal(tokaxisGoogleModelForSize("tokaxis::gemini-3.1-flash-image-1k", "4K"), "tokaxis::gemini-3.1-flash-image-4k");

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

console.log("Google image model contract passed: 3 model names, 14 ratios, native 1K/2K/4K sizes.");
