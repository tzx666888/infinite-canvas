import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FACEBOOK_MEDIA_PRESETS, facebookMediaTargetSize, facebookVideoSourceSize } from "../src/lib/facebook-media.ts";
import { normalizeMiniMaxH3AspectRatio } from "../src/lib/minimax-h3-video.ts";
import { normalizeSeedanceRatio } from "../src/lib/seedance-video.ts";
import { normalizeImageSizeForSelectedModel } from "../src/lib/tokaxis-google-image.ts";
import { videoAspectRatioForSize } from "../src/lib/video-providers/shared.ts";

assert.deepEqual(
    FACEBOOK_MEDIA_PRESETS.map((preset) => preset.id),
    ["FB-9:16", "FB-4:5", "FB1.91:1"],
);
assert.equal(facebookMediaTargetSize("FB-9:16"), "1080x1920");
assert.equal(facebookMediaTargetSize("FB-4:5"), "1080x1350");
assert.equal(facebookMediaTargetSize("FB1.91:1"), "1200x628");
assert.equal(facebookVideoSourceSize("FB-4:5"), "720x1280");
assert.equal(facebookVideoSourceSize("FB1.91:1"), "1280x720");
assert.equal(normalizeMiniMaxH3AspectRatio("FB-4:5"), "9:16");
assert.equal(normalizeMiniMaxH3AspectRatio("FB1.91:1"), "16:9");
assert.equal(normalizeSeedanceRatio("FB-9:16"), "9:16");
assert.equal(normalizeSeedanceRatio("FB1.91:1"), "16:9");
assert.equal(videoAspectRatioForSize("FB-4:5"), "9:16");
assert.equal(videoAspectRatioForSize("FB1.91:1"), "16:9");
assert.equal(normalizeImageSizeForSelectedModel("gemini-3.1-flash-image-4k", "FB-9:16"), "1080x1920");

const imagePanel = readFileSync(new URL("../src/components/image-settings-panel.tsx", import.meta.url), "utf8");
const videoPanel = readFileSync(new URL("../src/components/video-settings-panel.tsx", import.meta.url), "utf8");
const videoService = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
assert.match(imagePanel, /FACEBOOK_MEDIA_PRESETS/);
assert.match(videoPanel, /FACEBOOK_MEDIA_PRESETS/);
assert.match(videoService, /\/api\/media\/facebook-video/);

console.log("Facebook image/video preset regression passed");
