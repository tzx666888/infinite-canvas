export const GROK_STORYBOARD_CONSTRAINT_TEMPLATE_VERSION = "channel-28-v3-creative-montage";
export const STORYBOARD_DIRECTED_VIDEO_MARKER = "STORYBOARD-DIRECTED VIDEO.";

type StoryboardVideoConstraintInput = {
    userDirection: string;
    duration: number;
    sourcePanelCount: number;
    attachedReferenceCount: number;
    identityReferenceCount: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
    audioDirection: string;
};

/**
 * Versioned provider-facing constraint structure distilled from the successful
 * channel 28 request family. Task-specific text and private references are not
 * copied; callers supply the current user's direction and actual reference map.
 */
export function buildStoryboardVideoConstraintPrompt(input: StoryboardVideoConstraintInput) {
    const attachedReferenceCount = Math.max(0, Math.floor(input.attachedReferenceCount));
    const identityReferenceCount = Math.min(attachedReferenceCount, Math.max(0, Math.floor(input.identityReferenceCount)));
    const storyboardAnchorCount = Math.max(0, attachedReferenceCount - identityReferenceCount);
    const timelineStart = identityReferenceCount + 1;
    const timelineEnd = identityReferenceCount + storyboardAnchorCount;
    const referenceRoles =
        identityReferenceCount > 0 && storyboardAnchorCount > 0
            ? `<IMAGE_1> is the exact product/source identity lock and is not a timeline shot. <IMAGE_${timelineStart}> through <IMAGE_${timelineEnd}> are ordered timeline anchors sampled from the original ${input.sourcePanelCount}-panel storyboard.`
            : identityReferenceCount > 0
              ? `<IMAGE_1> is the exact product/source identity lock. No storyboard timeline image is attached; never invent an IMAGE_2.`
              : storyboardAnchorCount > 0
                ? `<IMAGE_1> through <IMAGE_${storyboardAnchorCount}> are ordered timeline anchors sampled from the original ${input.sourcePanelCount}-panel storyboard.`
                : "No storyboard timeline image is attached; use only the written direction and do not invent image references.";

    if (storyboardAnchorCount === 0) {
        return [
            STORYBOARD_DIRECTED_VIDEO_MARKER,
            `Create exactly ${input.duration} seconds of reference-led footage using the attached source only as the opening and identity anchor.`,
            `Reference role: ${referenceRoles}`,
            "Identity lock: preserve the same adult face, hair, wardrobe, body proportions, environment, and every visible rigid object across the entire video.",
            "Edit lock: follow the user's requested action order and use direct editorial cuts between distinct shots. Never morph, cross-dissolve, stretch, merge, or redraw a person or object during a transition.",
            "Entity lock: do not invent a product, package, bottle, tool, prop, second person, or unrelated scene unless the user direction explicitly names it.",
            "Human lock: keep natural head, neck, shoulders, torso, arms, hands, legs, and finger count. Never stretch a person to fill the frame.",
            input.audioDirection,
            "Output only clean full-frame footage: no grid, panels, numbers, badges, captions, subtitles, arrows, watermark, fake price, fake discount, certification, medical claim, or impossible result.",
            `User direction: ${input.userDirection}`,
        ]
            .filter(Boolean)
            .join("\n");
    }

    return [
        STORYBOARD_DIRECTED_VIDEO_MARKER,
        "Treat every attached image as a mandatory reference, not loose inspiration.",
        `Create exactly ${input.duration} seconds of polished ${input.aspectRatio} direct-response ecommerce footage with clean edited cuts.`,
        `Reference roles: ${referenceRoles}`,
        "Timeline: 0-18% exaggerated but believable problem/reaction hook; 18-32% product rescue reveal; 32-68% application plus visible proof; 68-86% clean result contrast; 86-100% label-readable product hero with the improved result behind it.",
        "Product lock: preserve the exact package silhouette, nozzle/closure geometry, dominant colors, logo position, label blocks, printed layout, scale, and object count visible in the attached identity/product references. Never rename, translate, recolor, rebrand, simplify, or replace the package. Preserve uncertain label marks instead of inventing words.",
        "Shot lock: follow timeline references in order and infer only the omitted in-between beats. Use one stable subject and local physical motion per shot. No morphs, cross-dissolves, repeated opening, unrelated footage, or more than two near-identical action shots.",
        `Human lock: use one consistent presenter face, hair, clothing, age, and body. Keep reaction shots chest-up and brief. Preserve natural head, neck, shoulders, torso, arms, hands, and finger count; never stretch a person to fill ${input.aspectRatio} or fuse a person with the product.`,
        "Commerce rhythm: the product appears in the opening third, demonstration, and final hero. The proof must be believable, and the ending must visibly resolve the original problem.",
        input.audioDirection,
        "Output only clean full-frame footage: no grid, panels, numbers, badges, captions, subtitles, arrows, watermark, fake price, fake discount, certification, medical claim, or impossible result.",
        `User direction: ${input.userDirection}`,
    ]
        .filter(Boolean)
        .join("\n");
}

export function unwrapStoryboardVideoUserDirection(prompt: string) {
    let value = prompt.trim();
    for (let depth = 0; depth < 6 && value.includes(STORYBOARD_DIRECTED_VIDEO_MARKER); depth += 1) {
        const matches = [...value.matchAll(/(?:^|\n)User direction:\s*/g)];
        const last = matches.at(-1);
        if (!last || last.index === undefined) return "";
        const next = value.slice(last.index + last[0].length).trim();
        if (!next || next === value) return "";
        value = next;
    }
    return value.includes(STORYBOARD_DIRECTED_VIDEO_MARKER) ? "" : value;
}
