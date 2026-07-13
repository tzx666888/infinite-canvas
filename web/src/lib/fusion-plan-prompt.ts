import type { CanvasFusionPlacementPlan } from "@/app/(user)/canvas/types";
import type { ReferenceImage } from "@/types/image";

type FusionPlannerMessage = {
    role: "system" | "user";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export const FUSION_PLANNER_SYSTEM_PROMPT = `你是一个场景感知的商品融合规划器，不是排版设计师。
Image 1 是目标场景图。
Image 2 及之后是要融入场景的产品图。
用户任务只能决定摆放和交互，不能改变产品身份。产品参考图是几何、部件数量、颜色、材质和标签布局的唯一真实来源。

必须根据 Image 1 的真实空间结构判断产品怎么摆：
- 台面 / 桌面 / 货架 / 地面
- 空白区和可承重区域
- 遮挡关系
- 镜头透视
- 光源方向
- 景深和清晰度

禁止使用固定模板：
- 不要左中右平均排布
- 不要前排后排机械排布
- 不要把产品当贴纸平铺
- 不要为了展示产品而破坏场景逻辑
- 不要让产品做大角度旋转或暴露参考图中不可见的侧面
- 如果透视适配会导致产品变形，应调整摆放点、尺寸或朝向，而不是改产品结构
- 产品必须完整落在画面内，主体轮廓、关键部件和标签区域清楚可见；不要把产品藏在人物、家具或其他道具后面
- 如果自然摆放位置会造成明显遮挡，应换一个真实可用的落点，而不是接受产品缺失、裁切或不可辨认

中文标签规则：
- 不要猜不确定的中文文字
- 看不清时只描述"中文标签布局、白色文字块、品牌区域、图标区域"
- 只有非常确定时才输出 observedText

输出严格 JSON，不要 Markdown，不要解释。`;

const FUSION_PLANNER_JSON_INSTRUCTIONS = `输出 JSON 结构必须完全匹配：
{
  "scene": {
    "summary": "场景空间一句话总结",
    "camera": "镜头角度、景别、透视关系",
    "light": "主光方向、色温、阴影特征",
    "usableSurfaces": [
      {
        "name": "可摆放表面名称",
        "reason": "为什么适合摆放",
        "roughRegion": {
          "area": "自然语言区域，例如 right-front countertop",
          "horizontal": "left third | center | right third | full width 等自然语言",
          "depth": "foreground | midground | background",
          "vertical": "lower half | center band | upper shelf 等自然语言"
        }
      }
    ],
    "avoidAreas": ["不能遮挡或不宜摆放的区域"]
  },
  "products": [
    {
      "imageIndex": 2,
      "identity": "产品身份英文描述，包含外轮廓比例、颜色、材质、关键部件的准确数量与相对排列、开口或旋钮、标签布局",
      "colors": ["主色"],
      "materials": ["材质"],
      "labelLayout": "标签/品牌区域布局；看不清文字时不要猜字",
      "observedText": "",
      "textStatus": "unverified"
    }
  ],
  "placements": [
    {
      "imageIndex": 2,
      "position": "产品在真实场景中的自然语言位置，不要写数字坐标",
      "reason": "为什么放这里最自然",
      "scale": "相对画面和附近物体的尺寸",
      "orientation": "优先保持与产品参考图接近的可见面，只做最小的朝向和透视适配",
      "contact": "与台面/货架/地面的接触方式",
      "shadow": "阴影方向和柔硬程度",
      "occlusion": "说明如何避免产品主体、关键部件和标签区域被遮挡；手持等交互只允许必要的局部接触"
    }
  ]
}

要求：
- products 数量必须等于产品图数量。
- placements 数量必须等于产品图数量。
- imageIndex 必须对应输入图片编号，Image 2 的 imageIndex 是 2。
- 不要输出 box、x、y、w、h 或任何数字坐标。`;

export function buildFusionPlannerMessages(sceneImage: ReferenceImage, productImages: ReferenceImage[], userPrompt = ""): FusionPlannerMessage[] {
    const imageParts = [sceneImage, ...productImages].map((image) => ({
        type: "image_url" as const,
        image_url: { url: image.dataUrl },
    }));

    return [
        { role: "system", content: FUSION_PLANNER_SYSTEM_PROMPT },
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: [
                        `Image 1 是目标场景图。Image 2-${productImages.length + 1} 是要融入场景的产品图。`,
                        userPrompt.trim() ? `用户任务：${userPrompt.trim()}` : "用户未指定具体摆位，请根据场景自动规划。",
                        "请先理解 Image 1 的真实空间结构，再为每个产品规划自然摆放位置。",
                        "摆放必须基于场景真实可用空间、透视、光线、遮挡关系，不要套固定模板。",
                        "每件产品必须完整落在画面内且清楚可辨；优先选择不会被人物或场景物体遮住的位置。",
                        FUSION_PLANNER_JSON_INSTRUCTIONS,
                    ].join("\n\n"),
                },
                ...imageParts,
            ],
        },
    ];
}

export function buildSceneAwareImageEditPrompt(plan: CanvasFusionPlacementPlan, userPrompt = "") {
    const userRequest = userPrompt.trim();
    const products = plan.products.map((product, index) => {
        const productNumber = index + 1;
        const colors = product.colors.length ? ` Colors: ${product.colors.join(", ")}.` : "";
        const materials = product.materials.length ? ` Materials: ${product.materials.join(", ")}.` : "";
        const label = product.labelLayout ? ` Label layout: ${product.labelLayout}.` : "";
        const textRule = product.textStatus === "verified" && product.observedText?.trim() ? ` Preserve the verified visible text "${product.observedText.trim()}" exactly where it appears.` : " Do not guess, rewrite, translate, or invent label text.";
        return `Image ${product.imageIndex} is Product ${productNumber}: ${product.identity}.${colors}${materials}${label}${textRule}`;
    });

    const placements = plan.placements.map((placement, index) => {
        const productNumber = productNumberForImageIndex(plan, placement.imageIndex) ?? index + 1;
        return [
            `Product ${productNumber}: ${placement.position}.`,
            placement.reason ? `Reason: ${placement.reason}.` : "",
            placement.scale ? placement.scale : "",
            placement.orientation ? placement.orientation : "",
            placement.contact ? placement.contact : "",
            placement.shadow ? placement.shadow : "",
            placement.occlusion ? placement.occlusion : "",
        ]
            .filter(Boolean)
            .join(" ");
    });

    const avoidAreas = plan.scene.avoidAreas.length ? `Avoid covering or altering: ${plan.scene.avoidAreas.join("; ")}.` : "";
    const surfaces = plan.scene.usableSurfaces.length ? `Usable scene surfaces identified by the planner: ${plan.scene.usableSurfaces.map((surface) => `${surface.name} (${surface.reason})`).join("; ")}.` : "";

    return [
        "Edit Image 1 into one photorealistic composite.",
        "",
        "BASE SCENE",
        `Image 1 is the target scene: ${plan.scene.summary}.`,
        plan.scene.camera ? `Camera and perspective: ${plan.scene.camera}.` : "",
        plan.scene.light ? `Lighting: ${plan.scene.light}.` : "",
        surfaces,
        avoidAreas,
        "Preserve the original camera angle, background, lighting, and all scene content outside the placement areas.",
        userRequest ? `User request: ${userRequest}. Follow it only when it does not conflict with product identity or natural scene placement.` : "",
        "",
        "PRODUCTS",
        ...products,
        "",
        "PLACEMENT",
        ...placements,
        "",
        "IDENTITY LOCK",
        "Each product reference is an immutable identity source, not style inspiration and not a request to redesign it.",
        "Preserve the exact outer contour, aspect ratio, topology, component count, component spacing, openings, knobs, ridges, colors, materials, package geometry, logo area, label layout, and visible brand area.",
        "Keep the same visible product face and stay close to the reference viewpoint. Do not invent unseen sides or reconstruct hidden geometry.",
        "Use only whole-object translation, uniform scaling, and the smallest possible rigid rotation. Never bend, locally warp, stretch, melt, simplify, merge, duplicate, replace, or exchange parts.",
        "If planned perspective conflicts with identity fidelity, preserve the product and adjust placement, scale, or orientation instead.",
        "Preserve existing label and logo graphics as visual shapes; do not redraw, translate, rewrite, or invent text.",
        "PRODUCT PRESENCE AND VISIBILITY LOCK",
        "Insert every referenced product exactly once. The result is invalid if a product is omitted, duplicated, cropped out, hidden, or no longer clearly recognizable.",
        "Keep every product fully inside the frame with its identity-defining silhouette, component count, component arrangement, openings, and label area clearly visible.",
        "Do not place products behind people, furniture, or unrelated scene objects. For an explicitly requested interaction such as holding, allow only the minimal natural hand contact and never cover identity-defining parts.",
        "If a planned location causes important occlusion, move the whole product to another physically plausible nearby location instead of accepting the occlusion or altering the product.",
        "Before returning the image, verify that the number of inserted products and the visible component count of each product match their reference images.",
        "Match the scene perspective, surface contact, ambient light, contact shadows, reflections, depth of field, grain, and edge softness.",
        "Return only the final edited image.",
    ]
        .filter(Boolean)
        .join("\n");
}

function productNumberForImageIndex(plan: CanvasFusionPlacementPlan, imageIndex: number) {
    const productIndex = plan.products.findIndex((product) => product.imageIndex === imageIndex);
    return productIndex >= 0 ? productIndex + 1 : null;
}
