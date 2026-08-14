import { createHmac } from "node:crypto";

type CanvasAttributionIdentity = {
    userId: string;
    username: string;
};

export function buildCanvasAttributionHeaders(identity: CanvasAttributionIdentity, requestId: string) {
    const username = encodeCanvasUsernameHeader(identity.username);
    const headers = new Headers({
        "X-Canvas-User-Id": identity.userId,
        "X-Canvas-Username": username,
        "X-Canvas-Request-Id": requestId,
    });
    const secret = process.env.CANVAS_AUTH_SHARED_SECRET?.trim();
    if (!secret) return headers;
    const payload = `${identity.userId}\n${username}\n${requestId}`;
    headers.set("X-Canvas-Attribution", createHmac("sha256", secret).update(payload).digest("hex"));
    return headers;
}

function encodeCanvasUsernameHeader(value: string) {
    const username = value.trim();
    if (/^[\x20-\x7e]+$/.test(username) && !username.startsWith("utf8-b64:")) return username;
    return `utf8-b64:${Buffer.from(username, "utf8").toString("base64url")}`;
}
