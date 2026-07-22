import assert from "node:assert/strict";

import {
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
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "5056x3392"), "3840x2576", "切换到 GPT Image 2 应保留比例并限制最长边");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "4096x4096"), "3840x3840", "方形 Google 4K 应安全收缩");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "1:8"), "auto", "GPT Image 2 不应继承 Google 超宽比");
assert.equal(normalizeImageSizeForSelectedModel("tokaxis::gpt-image-2", "2048x2048"), "2048x2048", "已合法的尺寸不应改动");

console.log("Google image model contract passed: 3 model names, 14 ratios, native 1K/2K/4K sizes.");
