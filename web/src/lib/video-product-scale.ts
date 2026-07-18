export type VideoProductScaleMode = "auto" | "handheld" | "tabletop" | "floor" | "wearable" | "oversized";

export const videoProductScaleOptions: Array<{ value: VideoProductScaleMode; label: string }> = [
    { value: "auto", label: "自动" },
    { value: "handheld", label: "小件" },
    { value: "tabletop", label: "中件" },
    { value: "floor", label: "大件" },
    { value: "wearable", label: "穿戴" },
    { value: "oversized", label: "超大" },
];

export function normalizeVideoProductScaleMode(value?: string): VideoProductScaleMode {
    const normalized = (value || "").trim().toLowerCase();
    return videoProductScaleOptions.some((item) => item.value === normalized) ? (normalized as VideoProductScaleMode) : "auto";
}

export function buildVideoProductScalePrompt(value?: string) {
    const mode = normalizeVideoProductScaleMode(value);
    const shared = [
        "PRODUCT SCALE LOCK:",
        "- Use the opening/reference frame as the exact apparent-size reference for the product.",
        "- Preserve real-world scale relative to hands, body, room, furniture, tabletop, floor, and nearby objects.",
        "- Do not shrink, enlarge, stretch, redesign, or turn the product into a different size class.",
        "- Keep the product bounding box stable except for natural perspective changes; avoid extreme push-in close-ups unless the user explicitly asks.",
    ];
    if (mode === "handheld") {
        shared.push(
            "- Product size class: small handheld item.",
            "- The product should stay naturally sized for one hand or two hands, roughly 15%-25% of frame height when clearly shown.",
            "- The presenter may hold it, but must not turn it into an oversized prop or push it into a giant close-up.",
        );
    } else if (mode === "tabletop") {
        shared.push(
            "- Product size class: medium tabletop or two-hand display item.",
            "- The product should sit on a table/surface or be held with both hands, roughly 25%-45% of frame height when clearly shown.",
            "- Do not make it tiny like a small handheld accessory or huge like floor-standing equipment.",
        );
    } else if (mode === "floor") {
        shared.push(
            "- Product size class: large floor-standing item.",
            "- The product should stand on the floor or occupy room space, roughly 45%-75% of frame height when clearly shown.",
            "- A person stands beside it or interacts naturally with it; do not let anyone hold it like a small object.",
        );
    } else if (mode === "wearable") {
        shared.push("- Product size class: wearable item.", "- Preserve scale relative to the correct body part; keep the item worn, carried, or fitted naturally.", "- Do not turn it into a tabletop prop, oversized object, or unrelated accessory.");
    } else if (mode === "oversized") {
        shared.push(
            "- Product size class: oversized equipment, vehicle, furniture, or installation.",
            "- Use people, doors, walls, street, room, or landscape elements as scale anchors.",
            "- The product should dominate the scene naturally and must never become handheld or miniature.",
        );
    } else {
        shared.push("- Product size class: infer from the product reference and scene; choose the realistic physical scale.", "- If scale is ambiguous, keep the scale shown in the opening/reference frame instead of inventing a new one.");
    }
    return shared.join("\n");
}

export function buildCompactVideoProductScalePrompt(value?: string) {
    const mode = normalizeVideoProductScaleMode(value);
    if (mode === "auto") return "";
    const directions: Record<Exclude<VideoProductScaleMode, "auto">, string> = {
        handheld: "Scale lock: keep the product hand-sized as shown in the keyframe; never enlarge it.",
        tabletop: "Scale lock: keep the product at its shown medium tabletop or two-hand size.",
        floor: "Scale lock: keep the product floor-standing; never make it handheld or miniature.",
        wearable: "Scale lock: keep the wearable naturally fitted to the correct body part.",
        oversized: "Scale lock: keep the product oversized beside people, doors, furniture, or its environment.",
    };
    return directions[mode];
}
