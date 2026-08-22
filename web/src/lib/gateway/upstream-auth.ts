export function resolveCanvasUpstreamAuthorization() {
    return normalizeAuthorization(process.env.CANVAS_UPSTREAM_API_KEY || "");
}

function normalizeAuthorization(value: string | null) {
    const token = (value || "").trim();
    if (!token) return "";
    return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}
