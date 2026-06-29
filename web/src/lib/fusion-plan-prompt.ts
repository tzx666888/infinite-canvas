import type { CanvasFusionPlacementPlan } from "@/app/(user)/canvas/types";
import type { ReferenceImage } from "@/types/image";

type FusionPlannerMessage = {
    role: "system" | "user";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export const FUSION_PLANNER_SYSTEM_PROMPT = `你是一个场景感知的商品融合规划器，不是排版设计师。
Image 1 是目标场景图。
Image 2 及之后是要融入场景的产品图。

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
      "identity": "产品身份英文描述，包含形状、颜色、材质、关键部件、标签布局",
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
      "orientation": "朝向和透视适配",
      "contact": "与台面/货架/地面的接触方式",
      "shadow": "阴影方向和柔硬程度",
      "occlusion": "遮挡或被遮挡关系"
    }
  ]
}

要求：
- products 数量必须等于产品图数量。
- placements 数量必须等于产品图数量。
- imageIndex 必须对应输入图片编号，Image 2 的 imageIndex 是 2。
- 不要输出 box、x、y、w、h 或任何数字坐标。`;

export function buildFusionPlannerMessages(sceneImage: ReferenceImage, productImages: ReferenceImage[]): FusionPlannerMessage[] {
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
                        "请先理解 Image 1 的真实空间结构，再为每个产品规划自然摆放位置。",
                        "摆放必须基于场景真实可用空间、透视、光线、遮挡关系，不要套固定模板。",
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
        "Reproduce each product from its own reference image, not as a redesigned product.",
        "Preserve each product's shape, proportions, colors, package geometry, logo area, label layout, materials, and visible brand area.",
        "Do not recolor, reshape, merge, duplicate, flatten, stretch, simplify, replace, or exchange parts between products.",
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
