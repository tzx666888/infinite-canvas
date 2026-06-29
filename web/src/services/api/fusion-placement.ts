import { buildFusionPlannerMessages } from "@/lib/fusion-plan-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasFusionPlacementPlan } from "@/app/(user)/canvas/types";
import type { ReferenceImage } from "@/types/image";

const DEFAULT_FUSION_PLANNER_MODEL = "default::gpt-5.5";

export async function requestFusionPlacementPlan(config: AiConfig, sceneImage: ReferenceImage, productImages: ReferenceImage[], options?: { signal?: AbortSignal }) {
    if (!productImages.length) throw new Error("融图规划至少需要一张产品图");
    const plannerModel = config.textModel || DEFAULT_FUSION_PLANNER_MODEL;
    const requestConfig = resolveModelRequestConfig(config, plannerModel);
    const hydratedSceneImage = await hydrateReferenceImage(sceneImage);
    const hydratedProductImages = await Promise.all(productImages.map(hydrateReferenceImage));
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const payload = await requestFusionPlacementPlanOnce(requestConfig, hydratedSceneImage, hydratedProductImages, attempt === 0, options);
            return normalizeFusionPlacementPlan(parseFusionPlacementPlan(payload, productImages.length), requestConfig.model, productImages.length);
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(lastError instanceof Error ? lastError.message : "融图摆放规划失败");
}

async function requestFusionPlacementPlanOnce(config: AiConfig, sceneImage: ReferenceImage, productImages: ReferenceImage[], useResponseFormat: boolean, options?: { signal?: AbortSignal }) {
    const response = await fetch(aiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: aiHeaders(config),
        body: JSON.stringify({
            model: config.model,
            messages: buildFusionPlannerMessages(sceneImage, productImages),
            stream: true,
            max_tokens: 2400,
            temperature: 0.12,
            ...(useResponseFormat ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: options?.signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const parsed = safeParseJson(text);
        const error = parsed?.error as Record<string, unknown> | undefined;
        const message = error?.message || parsed?.msg || parsed?.message || `Request failed with status code ${response.status}`;
        throw new Error(typeof message === "string" ? message : `融图摆放规划失败 (${response.status})`);
    }
    return collectStreamedContent(response);
}

async function collectStreamedContent(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("融图摆放规划失败：无响应流");
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "data: [DONE]") continue;
                if (!trimmed.startsWith("data: ")) continue;
                try {
                    const data = JSON.parse(trimmed.slice(6));
                    const delta = data.choices?.[0]?.delta?.content;
                    if (delta) content += delta;
                    const errorMessage = data.error?.message;
                    if (errorMessage) throw new Error(errorMessage);
                } catch (e) {
                    if (e instanceof Error && e.message !== "融图摆放规划失败") throw e;
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
    if (!content.trim()) throw new Error("融图摆放规划失败：模型未返回内容");
    return content.trim();
}

async function hydrateReferenceImage(image: ReferenceImage): Promise<ReferenceImage> {
    return { ...image, dataUrl: await imageToDataUrl(image) };
}

function parseFusionPlacementPlan(content: string, expectedProductCount: number): CanvasFusionPlacementPlan {
    const parsed = parseJsonObject(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("融图规划返回格式错误");
    const plan = parsed as Partial<CanvasFusionPlacementPlan>;
    if (!plan.scene || typeof plan.scene !== "object") throw new Error("融图规划缺少 scene");
    if (!Array.isArray(plan.products)) throw new Error("融图规划缺少 products");
    if (!Array.isArray(plan.placements)) throw new Error("融图规划缺少 placements");
    if (plan.products.length !== expectedProductCount) throw new Error(`融图规划产品数量不一致：期望 ${expectedProductCount}，实际 ${plan.products.length}`);
    if (plan.placements.length !== expectedProductCount) throw new Error(`融图规划摆放数量不一致：期望 ${expectedProductCount}，实际 ${plan.placements.length}`);
    return plan as CanvasFusionPlacementPlan;
}

function normalizeFusionPlacementPlan(plan: CanvasFusionPlacementPlan, plannerModel: string, expectedProductCount: number): CanvasFusionPlacementPlan {
    const products = Array.from({ length: expectedProductCount }, (_, index) => {
        const fallbackImageIndex = index + 2;
        const product = plan.products[index] || {};
        return {
            imageIndex: numberOr(product.imageIndex, fallbackImageIndex),
            identity: stringOr(product.identity, `Product ${index + 1} from Image ${fallbackImageIndex}`),
            colors: stringArrayOr(product.colors),
            materials: stringArrayOr(product.materials),
            labelLayout: stringOr(product.labelLayout, "visible label or brand layout from the reference image"),
            observedText: typeof product.observedText === "string" ? product.observedText : undefined,
            textStatus: product.textStatus === "verified" ? ("verified" as const) : ("unverified" as const),
        };
    });
    const placements = Array.from({ length: expectedProductCount }, (_, index) => {
        const fallbackImageIndex = products[index]?.imageIndex || index + 2;
        const placement = plan.placements[index] || {};
        return {
            imageIndex: numberOr(placement.imageIndex, fallbackImageIndex),
            position: stringOr(placement.position, "a natural available surface in the target scene"),
            reason: stringOr(placement.reason, "fits the real scene surface and does not block key content"),
            scale: stringOr(placement.scale, "Use realistic scale relative to nearby scene objects."),
            orientation: stringOr(placement.orientation, "Match the scene camera perspective."),
            contact: stringOr(placement.contact, "Ground the product on the receiving surface."),
            shadow: stringOr(placement.shadow, "Add a soft contact shadow matching scene light."),
            occlusion: stringOr(placement.occlusion, "Use natural occlusion only where physically plausible."),
        };
    });

    return {
        scene: {
            summary: stringOr(plan.scene.summary, "target scene"),
            camera: stringOr(plan.scene.camera, ""),
            light: stringOr(plan.scene.light, ""),
            usableSurfaces: Array.isArray(plan.scene.usableSurfaces)
                ? plan.scene.usableSurfaces.map((surface) => ({
                      name: stringOr(surface.name, "available surface"),
                      reason: stringOr(surface.reason, "visually suitable for product placement"),
                      roughRegion: {
                          area: stringOr(surface.roughRegion?.area, "available scene area"),
                          horizontal: stringOr(surface.roughRegion?.horizontal, "natural horizontal position"),
                          depth: stringOr(surface.roughRegion?.depth, "natural depth"),
                          vertical: stringOr(surface.roughRegion?.vertical, "natural vertical band"),
                      },
                  }))
                : [],
            avoidAreas: stringArrayOr(plan.scene.avoidAreas),
        },
        products,
        placements,
        plannerModel,
    };
}

function parseJsonObject(content: string) {
    const text = content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
        throw new Error("融图规划未返回有效 JSON");
    }
}

function safeParseJson(text: string): Record<string, unknown> | null {
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function aiApiUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
    };
}

function stringOr(value: unknown, fallback: string) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOr(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArrayOr(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}
