import type { ReferenceImage } from "@/types/image";

import type { CanvasNodeData } from "../types";

export function buildSourceNodeReferenceImages(node: CanvasNodeData | null): ReferenceImage[] {
    if (!node || node.type !== "image") return [];
    const content = node.metadata?.content?.trim() || "";
    const storageKey = node.metadata?.storageKey?.trim() || "";
    if (!content && !storageKey) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata?.mimeType || "image/png",
            dataUrl: content,
            storageKey: storageKey || undefined,
        },
    ];
}
