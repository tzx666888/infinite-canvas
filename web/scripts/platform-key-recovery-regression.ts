import assert from "node:assert/strict";

import { canvasKeyBelongsToCurrentUser, isCanvasKeyAuthenticationError, isCanvasPlatformKey, shouldReplaceCanvasPlatformKey } from "../src/lib/platform-key-recovery.ts";
import type { CanvasApiKeySummary } from "../src/lib/auth/types.ts";

const activeKey: CanvasApiKeySummary = {
    id: "key-active",
    name: "平台默认 Key",
    prefix: "vc_live_abcd",
    lastFour: "wxyz",
    createdAt: "2026-08-23T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
};
const revokedKey: CanvasApiKeySummary = {
    ...activeKey,
    id: "key-revoked",
    prefix: "vc_live_dead",
    lastFour: "gone",
    revokedAt: "2026-08-23T01:00:00.000Z",
};

assert.equal(isCanvasPlatformKey(" vc_live_abcdefgh "), true);
assert.equal(isCanvasPlatformKey("sk-station"), false);
assert.equal(canvasKeyBelongsToCurrentUser("vc_live_abcd-middle-wxyz", [activeKey]), true);
assert.equal(canvasKeyBelongsToCurrentUser("vc_live_dead-middle-gone", [revokedKey]), false);
assert.equal(shouldReplaceCanvasPlatformKey({ apiKey: "", currentUserId: "user-a", apiKeys: [] }), true, "an empty Canvas credential must be provisioned");
assert.equal(shouldReplaceCanvasPlatformKey({ apiKey: "vc_live_abcd-middle-wxyz", currentUserId: "user-a", apiKeys: [activeKey] }), false, "a legacy Canvas credential may be bound to the current user when its server-side summary matches");
assert.equal(shouldReplaceCanvasPlatformKey({ apiKey: "vc_live_abcd-middle-wxyz", ownerUserId: "user-b", currentUserId: "user-a", apiKeys: [activeKey] }), true, "a Canvas credential owned by another browser session must never be reused");
assert.equal(shouldReplaceCanvasPlatformKey({ apiKey: "vc_live_missing-middle-nope", ownerUserId: "user-a", currentUserId: "user-a", apiKeys: [activeKey] }), true, "a revoked or unknown Canvas credential must be replaced");
assert.equal(shouldReplaceCanvasPlatformKey({ apiKey: "sk-customer-station-key", ownerUserId: "user-b", currentUserId: "user-a", apiKeys: [] }), false, "customer-provided NewAPI keys must never be replaced by Canvas recovery");
assert.equal(isCanvasKeyAuthenticationError(new Error("画布专用 Key 无效或已撤销")), true);
assert.equal(isCanvasKeyAuthenticationError(new Error("模型列表同步失败：401")), true);
assert.equal(isCanvasKeyAuthenticationError(new Error("网络暂时不可用")), false);

console.log("platform key recovery regression checks passed");
