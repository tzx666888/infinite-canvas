import { buildFusionPlannerMessages } from "@/lib/fusion-plan-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasFusionPlacementPlan } from "@/app/(user)/canvas/types";
import type { ReferenceImage } from "@/types/image";

type ChatCompletionResponse = {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
    message?: string;
};

const DEFAULT_FUSION_PLANNER_MODEL = "tokaxis::gpt-5.6-sol";

type FusionPlacementRequestOptions = { signal?: AbortSignal; userPrompt?: string };

export async function requestFusionPlacementPlan(config: AiConfig, sceneImage: ReferenceImage, productImages: ReferenceImage[], options?: FusionPlacementRequestOptions) {
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

async function requestFusionPlacementPlanOnce(config: AiConfig, sceneImage: ReferenceImage, productImages: ReferenceImage[], useResponseFormat: boolean, options?: FusionPlacementRequestOptions) {
    const response = await fetch(aiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: { ...aiHeaders(config), Accept: "text/event-stream" },
        body: JSON.stringify({
            model: config.model,
            messages: buildFusionPlannerMessages(sceneImage, productImages, options?.userPrompt),
            stream: true,
            max_tokens: 2400,
            temperature: 0.12,
            ...(useResponseFormat ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readPlannerError(response));

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("text/event-stream")) {
        const payload = (await response.json()) as ChatCompletionResponse;
        return readPlannerContent(payload);
    }
    return collectStreamedContent(response);
}

async function collectStreamedContent(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("融图摆放规划失败：无响应流");

    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";
    const consumeEvent = (event: string) => {
        const dataText = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
            .trim();
        if (!dataText || dataText === "[DONE]") return;

        let payload: ChatCompletionResponse & { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
        try {
            payload = JSON.parse(dataText) as typeof payload;
        } catch {
            throw new Error("融图规划流返回格式错误");
        }
        if (payload.error?.message) throw new Error(payload.error.message);
        if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || payload.message || "融图摆放规划失败");
        const choice = payload.choices?.[0];
        content += choice?.delta?.content || choice?.message?.content || "";
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || "";
            events.forEach(consumeEvent);
            if (done) break;
        }
        if (buffer.trim()) consumeEvent(buffer);
    } finally {
        reader.releaseLock();
    }

    if (!content.trim()) throw new Error("融图摆放规划失败：模型未返回内容");
    return content.trim();
}

async function readPlannerError(response: Response) {
    const fallback = `融图摆放规划失败 (${response.status})`;
    const text = await response.text().catch(() => "");
    if (!text.trim()) return fallback;
    try {
        const payload = JSON.parse(text) as ChatCompletionResponse;
        return payload.error?.message || payload.msg || payload.message || fallback;
    } catch {
        return text.slice(0, 300) || fallback;
    }
}

const PLANNER_MAX_DIMENSION = 512;

async function hydrateReferenceImage(image: ReferenceImage): Promise<ReferenceImage> {
    const fullDataUrl = await imageToDataUrl(image);
    return { ...image, dataUrl: await downscaleForPlanner(fullDataUrl) };
}

function downscaleForPlanner(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            const width = image.naturalWidth;
            const height = image.naturalHeight;
            if (!width || !height) {
                reject(new Error("planner 图片尺寸无效"));
                return;
            }
            if (width <= PLANNER_MAX_DIMENSION && height <= PLANNER_MAX_DIMENSION) {
                resolve(dataUrl);
                return;
            }

            const scale = PLANNER_MAX_DIMENSION / Math.max(width, height);
            const targetWidth = Math.max(1, Math.round(width * scale));
            const targetHeight = Math.max(1, Math.round(height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const context = canvas.getContext("2d");
            if (!context) {
                reject(new Error("planner 图片压缩失败"));
                return;
            }
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, targetWidth, targetHeight);
            context.drawImage(image, 0, 0, targetWidth, targetHeight);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.onerror = () => reject(new Error("planner 图片加载失败"));
        image.src = dataUrl;
    });
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
    assertExactImageIndexes(plan.products, expectedProductCount, "产品身份");
    assertExactImageIndexes(plan.placements, expectedProductCount, "产品摆放");
    return plan as CanvasFusionPlacementPlan;
}

function normalizeFusionPlacementPlan(plan: CanvasFusionPlacementPlan, plannerModel: string, expectedProductCount: number): CanvasFusionPlacementPlan {
    const products = Array.from({ length: expectedProductCount }, (_, index) => {
        const fallbackImageIndex = index + 2;
        const product = plan.products.find((item) => item.imageIndex === fallbackImageIndex)!;
        return {
            imageIndex: fallbackImageIndex,
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
        const placement = plan.placements.find((item) => item.imageIndex === fallbackImageIndex)!;
        return {
            imageIndex: fallbackImageIndex,
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

function readPlannerContent(payload: ChatCompletionResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || payload.message || "融图摆放规划失败");
    if (payload.error?.message) throw new Error(payload.error.message);
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("融图摆放规划失败：模型未返回内容");
    return content;
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

function assertExactImageIndexes(items: Array<{ imageIndex?: unknown }>, expectedProductCount: number, label: string) {
    const expected = Array.from({ length: expectedProductCount }, (_, index) => index + 2);
    const actual = items.map((item) => item.imageIndex).filter((value): value is number => typeof value === "number" && Number.isInteger(value));
    const unique = new Set(actual);
    if (actual.length !== expected.length || unique.size !== expected.length || expected.some((value) => !unique.has(value))) {
        throw new Error(`融图规划${label}的图片编号错乱`);
    }
}

function stringArrayOr(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}
