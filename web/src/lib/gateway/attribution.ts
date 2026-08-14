import { createHmac } from "node:crypto";

type CanvasAttributionIdentity = {
    userId: string;
    username: string;
};

export function buildCanvasAttributionHeaders(identity: CanvasAttributionIdentity, requestId: string) {
    const headers = new Headers({
        "X-Canvas-User-Id": identity.userId,
        "X-Canvas-Username": identity.username,
        "X-Canvas-Request-Id": requestId,
    });
    const secret = process.env.CANVAS_AUTH_SHARED_SECRET?.trim();
    if (!secret) return headers;
    const payload = `${identity.userId}\n${identity.username}\n${requestId}`;
    headers.set("X-Canvas-Attribution", createHmac("sha256", secret).update(payload).digest("hex"));
    return headers;
}
