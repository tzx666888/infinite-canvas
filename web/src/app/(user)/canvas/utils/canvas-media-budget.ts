const mediaTypes = new Set(["image", "video", "audio"]);

type CanvasNodeData = {
    id: string;
    type: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    metadata?: { content?: string; storageKey?: string };
};

type ViewportTransform = { x: number; y: number; k: number };

export function selectRichMediaNodeIds(nodes: CanvasNodeData[], viewport: ViewportTransform, viewportSize: { width: number; height: number }, pinnedIds: Iterable<string> = []) {
    const pinned = new Set(pinnedIds);
    const limit = viewport.k < 0.14 ? 4 : viewport.k < 0.28 ? 10 : viewport.k < 0.5 ? 20 : 36;
    const center = {
        x: (-viewport.x + viewportSize.width / 2) / viewport.k,
        y: (-viewport.y + viewportSize.height / 2) / viewport.k,
    };
    const candidates = nodes.filter((node) => mediaTypes.has(node.type) && Boolean(node.metadata?.content || node.metadata?.storageKey)).sort((left, right) => distanceSquared(left, center) - distanceSquared(right, center));
    const selected = new Set(candidates.filter((node) => pinned.has(node.id)).map((node) => node.id));
    for (const node of candidates) {
        if (selected.size >= limit && !pinned.has(node.id)) break;
        selected.add(node.id);
    }
    return selected;
}

function distanceSquared(node: CanvasNodeData, point: { x: number; y: number }) {
    const dx = node.position.x + node.width / 2 - point.x;
    const dy = node.position.y + node.height / 2 - point.y;
    return dx * dx + dy * dy;
}
