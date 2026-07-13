import type { ReferenceImage } from "@/types/image";

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return [`参考图片按上传顺序固定编号为：${labels.join("、")}。`, "必须严格按编号理解图片角色，不得交换、合并或混淆不同图片中的主体。", "", text].join("\n");
}

export function buildIdentityPreservingImageEditPrompt(prompt: string, hasTargetImage: boolean, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!hasTargetImage || !references.length) return text;
    if (references.length === 1) {
        return [text, "", "STRICT IMAGE EDIT REQUIREMENTS:", "- Image 1 is the target/base image. Preserve its composition and all unrequested content.", "- Change only what the user explicitly requested.", "- Return only the edited image."].join("\n");
    }

    const productCount = references.length - 1;
    const productMappings = references.slice(1).map((_, index) => {
        const imageNumber = index + 2;
        const productNumber = index + 1;
        return `- Image ${imageNumber} is Product ${productNumber}, a separate immutable product identity. Reproduce that exact product, not a reinterpretation.`;
    });

    return [
        text,
        "",
        "STRICT IDENTITY-PRESERVING COMPOSITE EDIT:",
        "- Image 1 is the target/base scene. Preserve its camera angle, composition, background, and all content outside the requested placement area.",
        ...productMappings,
        `- Insert all ${productCount} referenced products as ${productCount} separate, clearly recognizable objects unless the user explicitly requests a different quantity.`,
        "- PRODUCT PRESENCE LOCK: insert every referenced product exactly once, fully inside the frame. Never omit, duplicate, crop out, hide, or replace a product.",
        "- PRODUCT IDENTITY LOCK: preserve each product's exact outer contour, topology, part count, part arrangement, proportions, openings, ridges, knobs, joints, surface material, transparency, color, label layout, and visible details.",
        "- Never fuse, blend, average, hybridize, stack into one object, or transfer parts, colors, or textures between products.",
        "- Never add, remove, bend, stretch, melt, simplify, redesign, or substitute any product component. Do not turn products into food, animals, decorations, or generic props.",
        "- Treat every product as an immutable rigid object. Use only whole-object translation, uniform scaling, and the smallest camera-consistent rotation needed; never warp local geometry.",
        "- Keep the same visible product face and a viewpoint close to its reference image. Never invent an unseen side or force a large rotation merely to fit the scene.",
        "- If scene perspective and product identity conflict, preserve the product and adjust its position, size, or orientation instead of reshaping it.",
        "- Match the target scene's support surface and camera perspective. When products are placed on or inside a horizontal surface such as a plate, tray, table, shelf, or floor, rest each one on a physically stable side unless the user explicitly asks for it to stand upright.",
        "- Apply only mild global foreshortening. Preserve component spacing, circular features, label proportions, and package aspect ratio without local stretching.",
        "- Use realistic scale relative to nearby objects and leave physically plausible spacing. Prefer a natural, slightly varied arrangement and orientation; avoid a perfectly rigid lineup unless the user requests one.",
        "- Ground every product on the receiving surface with believable contact points, soft contact shadows, ambient occlusion, and reflections/refraction. Products must not float.",
        "- Keep each product's identity-defining silhouette, components, openings, and label area clearly visible. Do not place products behind people, furniture, or unrelated scene objects. For explicitly requested handling, allow only minimal natural hand contact without covering identity-defining parts.",
        "- Match the target scene's light direction, color temperature, exposure, contrast, depth of field, sharpness, grain, and edge softness. Do not leave cutout halos or mismatched crispness.",
        "- Preserve existing logos and label graphics as visual shapes. Do not redraw, translate, replace, or invent product text.",
        "- Allowed product changes are limited to rigid placement, uniform scaling, minimal global perspective adjustment, natural occlusion, contact shadows, reflections/refraction, and scene-matched lighting.",
        "- The reference images are authoritative source assets, not style inspiration. If another instruction conflicts with product identity, PRODUCT IDENTITY LOCK wins.",
        "- Integrate the products naturally into the target scene while keeping every product visually distinct and faithful to its own reference image.",
        "- Before returning the image, verify that every requested product is present once and that its visible component count matches the corresponding reference image.",
        "- Return only the edited image.",
    ].join("\n");
}

export function buildMaskConstrainedImageEditPrompt(prompt: string) {
    return [
        prompt.trim(),
        "",
        "STRICT MASKED EDIT REQUIREMENTS:",
        "- The transparent area of the supplied mask is the only editable region. Opaque mask pixels are locked.",
        "- Do not regenerate, reinterpret, crop, resize, rotate, relight, recolor, sharpen, blur, or otherwise change any pixel outside the editable region.",
        "- Preserve the exact composition, camera, background, text, logos, people, objects, object geometry, materials, colors, lighting, shadows, and image quality outside the editable region.",
        "- Inside the editable region, perform only the user's requested change. Preserve the subject's identity, silhouette, topology, proportions, part count, and part arrangement unless the user explicitly asks to change structure.",
        "- Match the surrounding perspective, scale, focus, grain, lighting direction, color temperature, reflections, contact shadows, and edge softness so the edit blends naturally.",
        "- Do not add, remove, replace, recolor, or otherwise alter content beyond the user's explicit request.",
        "- Return only the edited image.",
    ].join("\n");
}
