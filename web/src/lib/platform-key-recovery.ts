import type { CanvasApiKeySummary } from "@/lib/auth/types";

const CANVAS_KEY_PREFIX = "vc_live_";

export function isCanvasPlatformKey(apiKey: string) {
    return apiKey.trim().startsWith(CANVAS_KEY_PREFIX);
}

export function canvasKeyBelongsToCurrentUser(apiKey: string, apiKeys: CanvasApiKeySummary[]) {
    const value = apiKey.trim();
    if (!isCanvasPlatformKey(value)) return false;
    return apiKeys.some((apiKeySummary) => !apiKeySummary.revokedAt && value.startsWith(apiKeySummary.prefix) && value.endsWith(apiKeySummary.lastFour));
}

export function shouldReplaceCanvasPlatformKey(input: { apiKey: string; ownerUserId?: string; currentUserId: string; apiKeys: CanvasApiKeySummary[] }) {
    const value = input.apiKey.trim();
    if (!value) return true;
    if (!isCanvasPlatformKey(value)) return false;
    if (input.ownerUserId && input.ownerUserId !== input.currentUserId) return true;
    return !canvasKeyBelongsToCurrentUser(value, input.apiKeys);
}

export function isCanvasKeyAuthenticationError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /(?:401|403|unauthori[sz]ed|forbidden|invalid(?:[_ -]api)?[_ -]?key|key[^\n]{0,12}(?:无效|失效|撤销)|无效[^\n]{0,12}key)/i.test(message);
}
