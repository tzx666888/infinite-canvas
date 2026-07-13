import assert from "node:assert/strict";

import type { CanvasFusionPlacementPlan } from "../src/app/(user)/canvas/types";
import { buildFusionPlannerMessages, buildSceneAwareImageEditPrompt } from "../src/lib/fusion-plan-prompt";
import { MAX_FUSION_PRODUCT_REFERENCES, resolveFusionReferenceRoles } from "../src/lib/fusion-reference-roles";
import { buildIdentityPreservingImageEditPrompt } from "../src/lib/image-reference-prompt";
import type { ReferenceImage } from "../src/types/image";

const scene = reference("scene", "scene.png");
const product = reference("product", "product.png");

const sceneFirst = resolveFusionReferenceRoles({
    prompt: "让图片1手持图片2生成广告图",
    references: [scene, product],
});
assert.ok(sceneFirst);
assert.equal(sceneFirst.sceneImage.id, "scene");
assert.deepEqual(
    sceneFirst.orderedImages.map((image) => image.id),
    ["scene", "product"],
);

const productFirst = resolveFusionReferenceRoles({
    prompt: "把图片1融入图片2的右侧台面",
    references: [product, scene],
});
assert.ok(productFirst);
assert.equal(productFirst.sceneImage.id, "scene");
assert.deepEqual(
    productFirst.orderedImages.map((image) => image.id),
    ["scene", "product"],
);
assert.match(productFirst.prompt, /把图片2融入图片1/);

const genericMultiReference = resolveFusionReferenceRoles({
    prompt: "Use image 1 and image 2 as loose color inspiration.",
    references: [scene, product],
});
assert.equal(genericMultiReference, null, "generic multi-reference generation must not be forced through product fusion planning");

const explicitScene = resolveFusionReferenceRoles({
    prompt: "自然合成",
    references: [product, scene],
    explicitSceneImageId: "scene",
    force: true,
});
assert.ok(explicitScene);
assert.equal(explicitScene.sceneImage.id, "scene");

const tooManyProducts = [scene, ...Array.from({ length: MAX_FUSION_PRODUCT_REFERENCES + 1 }, (_, index) => reference(`product-${index}`, `product-${index}.png`))];
assert.throws(() => resolveFusionReferenceRoles({ prompt: "把所有产品融入场景", references: tooManyProducts }), new RegExp(`一次最多融合 ${MAX_FUSION_PRODUCT_REFERENCES} 张产品图`));

const directEditPrompt = buildIdentityPreservingImageEditPrompt("把产品放到台面上", true, [scene, product]);
assert.match(directEditPrompt, /smallest camera-consistent rotation/i);
assert.match(directEditPrompt, /Never invent an unseen side/i);
assert.match(directEditPrompt, /preserve the product and adjust its position/i);
assert.match(directEditPrompt, /insert every referenced product exactly once/i);
assert.match(directEditPrompt, /identity-defining silhouette, components, openings, and label area clearly visible/i);
assert.doesNotMatch(directEditPrompt, /Re-render only its viewpoint through rigid 3D rotation/i);

const plan: CanvasFusionPlacementPlan = {
    scene: {
        summary: "kitchen counter with open space on the right",
        camera: "eye-level medium shot",
        light: "soft daylight from the left",
        usableSurfaces: [],
        avoidAreas: ["stove controls"],
    },
    products: [
        {
            imageIndex: 2,
            identity: "clear cylindrical massager with exactly nine red spherical knobs in three rows",
            colors: ["clear", "red"],
            materials: ["transparent plastic", "rubber"],
            labelLayout: "no label",
            textStatus: "unverified",
        },
    ],
    placements: [
        {
            imageIndex: 2,
            position: "right-front counter",
            reason: "available support surface",
            scale: "Keep realistic hand-sized scale.",
            orientation: "Keep the same visible front face with minimal yaw.",
            contact: "Rest on its flat base.",
            shadow: "Soft shadow to the right.",
            occlusion: "No important occlusion.",
        },
    ],
    plannerModel: "tokaxis::gpt-5.6-sol",
};

const sceneAwarePrompt = buildSceneAwareImageEditPrompt(plan, "把图片2融入图片1");
assert.match(sceneAwarePrompt, /exact outer contour, aspect ratio, topology, component count/i);
assert.match(sceneAwarePrompt, /exactly nine red spherical knobs/i);
assert.match(sceneAwarePrompt, /smallest possible rigid rotation/i);
assert.match(sceneAwarePrompt, /preserve the product and adjust placement/i);
assert.match(sceneAwarePrompt, /do not redraw, translate, rewrite, or invent text/i);
assert.match(sceneAwarePrompt, /PRODUCT PRESENCE AND VISIBILITY LOCK/);
assert.match(sceneAwarePrompt, /number of inserted products and the visible component count/i);

const plannerMessages = buildFusionPlannerMessages(scene, [product], "放在右侧台面");
const plannerUserContent = plannerMessages[1].content;
assert.ok(Array.isArray(plannerUserContent));
assert.match(plannerUserContent[0].type === "text" ? plannerUserContent[0].text : "", /用户任务：放在右侧台面/);
assert.match(plannerUserContent[0].type === "text" ? plannerUserContent[0].text : "", /完整落在画面内且清楚可辨/);

console.log("fusion prompt regression: passed");

function reference(id: string, name: string): ReferenceImage {
    return { id, name, type: "image/png", dataUrl: `data:image/png;base64,${id}` };
}
