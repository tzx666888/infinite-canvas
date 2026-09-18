// Canvas visibility only. Keep station channels and existing task retrieval intact.
export function isHiddenCanvasVideoModel(model: string) {
    const name = model.trim().toLowerCase().split("::").at(-1) || "";
    return name.startsWith("doubao-seedance-") || name.startsWith("qy-seedance-") || name === "seedance 2.0-fast-720p";
}
