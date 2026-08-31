import type { ReferenceImage } from "@/types/image";

const EXPLICIT_MULTI_PANEL_PATTERN =
    /(?:\b(?:collage|contact[ -]?sheet|storyboard|split[ -]?screen|multi[ -]?panel|diptych|triptych|before[ -]and[ -]after)\b|(?:^|[^\d])(?:2\s*[x×]\s*2|3\s*[x×]\s*3|4\s*[x×]\s*4)(?:[^\d]|$)|宫格|拼图|分屏|多面板|多格(?:布局|排版)?|联系表|分镜(?:板|表|图)|前后对比|对比图|四联画|九联画|多视图)/i;
const VAGUE_STYLE_CHANGE_PATTERN =
    /^(?:(?:请|帮我)?(?:(?:换|改)(?:成|个|一个|一种)?(?:不同|另一种|其他|新)?(?:的)?(?:风格|样式|效果)|(?:生成|做成?)?(?:一个|一种)?(?:不同|另一种|其他|新)(?:的)?(?:风格|样式|效果))(?:看看|试试)?[。！？!?]*|(?:please\s+)?(?:(?:make|use|try|create|change(?:\s+it)?(?:\s+to)?)\s+)?(?:a|an)?\s*(?:different|another|new|other)\s+(?:style|look|aesthetic)(?:\s+version)?[.!?]*)$/i;
const INDEPENDENT_STYLE_DIRECTIONS = [
    "clean editorial treatment with balanced natural color, crisp detail, and restrained composition",
    "cinematic treatment with directional light, deeper contrast, and a filmic color grade",
    "minimal premium treatment with a refined palette, negative space, and a polished finish",
    "candid lifestyle treatment with natural texture, lively framing, and authentic ambient light",
    "vintage analog treatment with gentle grain, tactile texture, and a muted period palette",
    "bold contemporary commercial treatment with vivid controlled color and graphic composition",
    "soft atmospheric treatment with diffused light, airy depth, and subtle pastel grading",
    "high-contrast monochrome fine-art treatment with sculpted light and rich tonal detail",
    "cool modern treatment with clean geometry, restrained color, and precise highlights",
    "warm retro-print treatment with nostalgic color separation and soft highlight rolloff",
    "dramatic low-key treatment with focused illumination, deep shadows, and a moody finish",
    "bright optimistic treatment with open composition, fresh color, and luminous soft light",
    "natural documentary treatment with honest texture, available light, and unforced framing",
    "polished luxury-editorial treatment with elegant lighting, rich materials, and controlled color",
    "experimental contemporary treatment with an unexpected palette, dynamic framing, and cohesive art direction",
];

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function requestsMultiPanelImage(prompt: string) {
    return EXPLICIT_MULTI_PANEL_PATTERN.test(prompt.trim());
}

export function isVagueStyleChangeRequest(prompt: string) {
    return VAGUE_STYLE_CHANGE_PATTERN.test(prompt.trim().replace(/\s+/g, " "));
}

export function buildIndependentImageStyleVariantPrompt(basePrompt: string, userPrompt: string, variantIndex: number, variantCount: number) {
    if (!isVagueStyleChangeRequest(userPrompt)) return basePrompt;
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(variantCount)) || 1));
    const index = Math.max(0, Math.min(count - 1, Math.floor(Math.abs(variantIndex)) || 0));
    const rules = [
        basePrompt.trim(),
        "",
        "VAGUE STYLE REQUEST INTERPRETATION:",
        "- Create one standalone full-frame image with one coherent alternative style that is visibly different from Image 1.",
        "- Preserve the same subject identity, anatomy, object count, and essential content. Do not create a comparison layout.",
    ];
    if (count > 1) {
        rules.push(
            `- This is independent style result ${index + 1} of ${count}. It must remain a separate image and must not contain the other variations.`,
            `- Distinct direction for this result: ${INDEPENDENT_STYLE_DIRECTIONS[index % INDEPENDENT_STYLE_DIRECTIONS.length]}.`,
        );
    }
    return rules.join("\n");
}

function imageEditOutputLayoutRules(prompt: string) {
    if (requestsMultiPanelImage(prompt)) {
        return ["- The user explicitly requested a multi-panel composition. Honor only the requested layout and panel count."];
    }
    return [
        "- OUTPUT LAYOUT LOCK: Return one continuous full-frame image containing one scene and one edited version of the subject.",
        "- Never create a collage, grid, split screen, contact sheet, before-and-after comparison, inset, multi-panel layout, or multiple style variations inside the image.",
        '- Phrases such as "different style", "another style", or "change the style" mean one alternative full-frame image, not several versions.',
    ];
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    const orderSteps = labels.map((label, index) => `- 第${index + 1}步：先执行${label}，完成该图片指定的主体/场景/构图作用后，才能进入下一步。`);
    return [
        `参考图片按上传顺序固定编号为：${labels.join("、")}。`,
        "参考连线执行顺序是强制性的：严格按 1 → 2 → 3（以实际图片数量为准）推进，不得自行重排。",
        ...orderSteps,
        "不得交换、合并、平均、混淆不同图片中的主体，也不得跳过任何已连接图片。",
        "",
        text,
    ].join("\n");
}

export function buildAllProductSceneImageEditPrompt(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const productMappings = references.map((_, index) => `- Image ${index + 1} is Product Reference ${index + 1}. Preserve every distinct product or SKU visible in it.`);

    return [
        text,
        "",
        "STRICT ALL-PRODUCT SCENE GENERATION:",
        "- None of the reference images is a base scene or background image. Every reference image is a product source.",
        ...productMappings,
        `- Include all ${references.length} connected product references in the final image. Never reinterpret, omit, replace, or use any reference as the background.`,
        "- If a product reference contains multiple visible product variants or package pieces, preserve all of them unless the user explicitly requests a subset.",
        "- Create one new coherent background or scene from the user's written request, then place every referenced product naturally into that new scene.",
        "- Keep each product visually separate and clearly recognizable. Preserve its contour, proportions, colors, materials, component count, label layout, and visible brand graphics.",
        "- Never fuse, average, hybridize, duplicate, or transfer parts, colors, labels, or textures between products.",
        "- Keep every product fully inside the frame with believable scale, contact shadows, reflections, perspective, lighting, and spacing.",
        "- Before returning the image, verify that every connected product reference is visibly represented in the final scene.",
        ...imageEditOutputLayoutRules(text),
        "- Return only the finished image.",
    ].join("\n");
}

export function buildIdentityPreservingImageEditPrompt(prompt: string, hasTargetImage: boolean, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!hasTargetImage || !references.length) return text;
    if (references.length === 1) {
        return [
            text,
            "",
            "STRICT IMAGE EDIT REQUIREMENTS:",
            "- Image 1 is the target/base image. Preserve its composition and all unrequested content.",
            "- Change only what the user explicitly requested.",
            ...imageEditOutputLayoutRules(text),
            "- Return only the edited image.",
        ].join("\n");
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
        ...imageEditOutputLayoutRules(text),
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
