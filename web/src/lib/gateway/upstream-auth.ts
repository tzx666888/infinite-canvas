export function resolveCanvasUpstreamAuthorization() {
    return normalizeAuthorization(process.env.CANVAS_UPSTREAM_API_KEY || "");
}

export function resolveStationUpstreamAuthorization(value: string | null) {
    const token = (value || "").trim().replace(/^Bearer\s+/i, "").trim();
    return token.startsWith("sk-") ? `Bearer ${token}` : "";
}

function normalizeAuthorization(value: string | null) {
    const token = (value || "").trim();
    if (!token) return "";
    return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}
