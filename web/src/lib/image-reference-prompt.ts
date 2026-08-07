import type { ReferenceImage } from "@/types/image";

const EXPLICIT_MULTI_PANEL_PATTERN =
    /(?:\b(?:collage|contact[ -]?sheet|storyboard|split[ -]?screen|multi[ -]?panel|diptych|triptych|before[ -]and[ -]after)\b|(?:^|[^\d])(?:2\s*[x×]\s*2|3\s*[x×]\s*3|4\s*[x×]\s*4)(?:[^\d]|$)|宫格|拼图|分屏|多面板|多格(?:布局|排版)?|联系表|分镜(?:板|表|图)|前后对比|对比图|四联画|九联画|多视图)/i;
const COMMERCE_DETAIL_SET_PATTERN =
    /(?:(?:一组|一套|整套|系列|多张|多个|若干|不同场景).{0,18}(?:电商|商品|产品)?(?:详情图|详情页|详情素材)|(?:电商|商品|产品)?(?:详情图|详情页|详情素材).{0,18}(?:一组|一套|整套|系列|多张|多个|若干|不同场景)|\b(?:set|series|multiple|different scenes?)\b.{0,40}\b(?:e-?commerce|product)\s+(?:detail|listing)\s+(?:images?|boards?|pages?)\b)/i;
const REFERENCE_DERIVED_IMAGE_PATTERN =
    /(?:(?:生成|制作|创建|设计|扩展|拓展|出|做成?).{0,20}(?:一组|一套|整套|系列|多张|多个|若干|不同场景|白底图|主图|详情图|详情页|海报|场景图|展示图|广告图|素材)|\b(?:generate|create|design|make|produce)\b.{0,50}\b(?:set|series|multiple|different scenes?|white background|hero image|listing image|detail board|product poster|campaign visual)\b)/i;
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
const COMMERCE_DETAIL_DIRECTIONS = [
    "premium hero presentation with packaging, recognizable silhouette, and controlled studio highlights",
    "real-world use context with natural hand interaction, believable scale, and a clear product focal point",
    "material and construction study with macro texture, component detail, and faithful label placement",
    "retail-ready presentation with product, package, included items, and clean shelf or countertop context",
    "lifestyle demonstration with an adult user, realistic environment, and unobstructed product visibility",
    "clean catalog presentation with front view, angled view, close detail, and package relationship",
];
const COMMERCE_DETAIL_LAYOUT_DIRECTIONS = [
    "a dominant product hero supported by a few organically sized detail zones",
    "a full-bleed lifestyle composition with restrained supporting product details",
    "an asymmetric editorial split that balances product, use context, and close detail",
    "a clean catalog composition with varied image scales and generous spacing",
    "a retail campaign composition with one strong focal area and secondary information zones",
    "a layered product-story composition that moves naturally from hero to use to detail",
    "a minimal premium composition with deliberate negative space and one carefully placed supporting detail",
];

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function requestsMultiPanelImage(prompt: string) {
    return EXPLICIT_MULTI_PANEL_PATTERN.test(prompt.trim());
}

export function isCommerceDetailSetRequest(prompt: string) {
    return COMMERCE_DETAIL_SET_PATTERN.test(prompt.trim().replace(/\s+/g, " "));
}

export function isReferenceDerivedImageGenerationRequest(prompt: string) {
    const text = prompt.trim().replace(/\s+/g, " ");
    return isCommerceDetailSetRequest(text) || REFERENCE_DERIVED_IMAGE_PATTERN.test(text);
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

export function buildCommerceDetailSetVariantPrompt(basePrompt: string, userPrompt: string, variantIndex: number, variantCount: number) {
    if (!isCommerceDetailSetRequest(userPrompt)) return basePrompt;
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(variantCount)) || 1));
    const index = Math.max(0, Math.min(count - 1, Math.floor(Math.abs(variantIndex)) || 0));
    const hasExplicitLayout = requestsMultiPanelImage(userPrompt);
    const rules = [
        basePrompt.trim(),
        "",
        "COMMERCE DETAIL SET INTERPRETATION:",
        "- Create one standalone e-commerce detail image as one member of the requested set.",
        "- Keep the exact product identity, shape, color, parts, logo, and label layout while creating a genuinely new scene and composition.",
        hasExplicitLayout
            ? "- Honor the exact layout and panel count explicitly requested by the user."
            : "- The layout is intentionally flexible: it may be full-bleed, split, asymmetric, editorial, or multi-section according to the content. Never force a fixed grid, fixed panel count, or the same layout across the set.",
        "- Do not combine all batch results into one contact sheet. Return only this result as one complete retail-ready image.",
        "- Do not invent claims, ingredients, certifications, prices, ratings, discounts, or testimonial text. Preserve only product wording visible in the reference or wording supplied by the user.",
    ];
    if (count > 1) {
        rules.push(
            `- This is independent detail-image result ${index + 1} of ${count}. It must differ visibly from the other results in both scene and composition.`,
            `- Distinct scene direction for this result: ${COMMERCE_DETAIL_DIRECTIONS[index % COMMERCE_DETAIL_DIRECTIONS.length]}.`,
        );
        if (!hasExplicitLayout) rules.push(`- Distinct layout direction for this result: ${COMMERCE_DETAIL_LAYOUT_DIRECTIONS[index % COMMERCE_DETAIL_LAYOUT_DIRECTIONS.length]}.`);
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

function referenceDerivedOutputLayoutRules(prompt: string) {
    if (requestsMultiPanelImage(prompt)) return imageEditOutputLayoutRules(prompt);
    if (!isCommerceDetailSetRequest(prompt)) return imageEditOutputLayoutRules(prompt);
    return [
        "- This commerce detail-set request creates a new retail composition rather than preserving Image 1's layout.",
        "- Keep each output standalone, but allow the layout to be full-bleed, split, asymmetric, editorial, or multi-section as appropriate. Do not force a fixed grid or panel count.",
    ];
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
        if (isReferenceDerivedImageGenerationRequest(text)) {
            return [
                text,
                "",
                "REFERENCE-DERIVED IMAGE GENERATION:",
                "- Image 1 is the authoritative product or subject identity reference, not a composition template.",
                "- Create a new composition that fulfills the requested scene or commerce asset instead of preserving Image 1's original background, crop, camera, or layout.",
                "- Preserve the exact subject identity, product silhouette, proportions, part count, part arrangement, materials, colors, logo, and label placement from Image 1.",
                "- Keep the product fully recognizable and physically plausible in every requested scene.",
                ...referenceDerivedOutputLayoutRules(text),
                "- Return only the newly composed image.",
            ].join("\n");
        }
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
