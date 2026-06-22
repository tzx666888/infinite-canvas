import axios from "axios";

import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type PolishMode = "image" | "video";
export type PolishTemplate = "optimize" | "product" | "scene" | "storyboard" | "videoprompt";

export type PolishReferenceImage = {
    dataUrl: string;
    label?: string;
    name?: string;
};

export type ProductDetailShot = {
    title: string;
    focus: string;
    prompt: string;
};

export type ProductBreakdownPlan = {
    productName: string;
    category: string;
    identity: string;
    materials: string[];
    components: string[];
    visibleMarks: string[];
    packageAccessories: string[];
    shots: ProductDetailShot[];
};

export type SceneExpansionShot = {
    title: string;
    focus: string;
    prompt: string;
};

export type SceneExpansionPlan = {
    productName: string;
    identity: string;
    scenes: SceneExpansionShot[];
};

const DEFAULT_POLISH_MODEL = "default::gpt-5.5";
const PRODUCT_DETAIL_FRAMING_CONTRACTS = [
    "Create a full-product hero photograph in a visibly new composition. Show the whole product at a clean three-quarter angle, occupying 65-80% of the frame on a new neutral studio sweep.",
    "Create a full-product side or opposite three-quarter view that reveals different visible faces than the source. Rotate only as a rigid object; use a new camera height and a new neutral background.",
    "Create an extreme material-and-surface macro. Crop the product deliberately so the requested texture fills at least 75% of the frame; do not show the full product.",
    "Create a tight identification-detail macro of the visible logo, label, signature color element, or most distinctive visible feature. The detail must fill at least 70% of the frame; do not return a full-product view.",
    "Create a close functional-component photograph. Frame only the requested component and its immediate connection to the product body, with clearly visible construction and material transitions.",
    "Create a close structural photograph of a visible opening, interface, rim, edge, joint, control, or bottom/top construction. Use an oblique macro angle and do not show the original full-product composition.",
    "Create a packaging-or-accessory detail only when it is visibly supported by the references. Otherwise create a second, clearly different structural macro of another visible product area. Never invent packaging or accessories.",
    "Create a complete-product editorial photograph from a top-down or low camera position, whichever differs most from the source. Use a new orientation, crop, lighting setup, and neutral background.",
] as const;

const OPTIMIZE_PROMPT_SYSTEM = `你是一位专业的AI生图提示词优化专家。用户会给你一段粗糙的图片/视频描述，你需要将其优化为高质量的生图提示词。

要求：
1. 保留用户原始意图，不改变主题和核心元素
2. 补充画面细节：光线、色调、构图、景别、材质质感
3. 增加专业摄影/设计术语提升画面质量
4. 输出中文，方便用户阅读和修改
5. 控制在 100-200 字
6. 不要加任何解释，只输出优化后的提示词
7. 禁止使用 beautiful / amazing / epic / stunning / gorgeous / incredible 这类空泛词`;

const PRODUCT_ANALYSIS_SYSTEM = `你是专业的电商产品拆解摄影策划师。你的任务不是撰写产品报告，而是读取参考图，锁定产品身份，并规划一组可以立即用于 AI 生图的独立细节镜头。

工作规则：
1. 参考图片是产品身份的唯一权威来源。精准识别轮廓、比例、部件数量与位置、颜色、材质、纹理、接口、按钮、开孔、标签、logo 和包装配件。
2. 不得把同一产品误拆成多个产品，不得改变结构、颜色、logo、文字、配件数量或部件位置。
3. 看不清或没有展示的包装、配件和隐藏结构不得编造；用图中可见且有价值的结构细节替代对应镜头。
4. 必须输出恰好 8 个互不重复的细节图任务，并让 8 张图在景别、机位和画面重点上有肉眼可见的区别。依次规划：完整产品新构图、45度或侧面、材质纹理微距、品牌/标识或最具识别度细节、核心部件、接口/开口/边缘结构、可见包装配件（未展示时改为另一处可见结构微距）、俯拍或低机位完整产品照。
5. 每个任务都必须是单张独立产品图，不做拼图、九宫格、文字说明页或信息图。
6. 每张图只突出一个明确重点，同时保持产品完整身份一致。除完整产品镜头外，微距镜头必须明显裁切产品、让目标细节占画面 70% 以上；不得把原参考图原样返回，也不得沿用原图背景、原图裁切和原图正面机位。背景简洁，使用商业产品摄影光线，不出现无关物品、人物、文字叠加或水印。
7. title 和 focus 使用中文；identity 和 prompt 使用具体、可执行的英文摄影描述。
8. 禁止使用 beautiful / amazing / epic / stunning / gorgeous / incredible 等空泛词。

只输出以下 JSON，不要 Markdown 代码块，不要解释：
{
  "productName": "从图片识别的中文产品名称",
  "category": "产品品类",
  "identity": "完整英文产品身份锁定描述，涵盖轮廓、颜色、材质、关键部件及其位置",
  "materials": ["中文材质和表面质感"],
  "components": ["中文可见部件及位置"],
  "visibleMarks": ["中文可见logo、标签、按钮、接口；没有则写无明确可见标识"],
  "packageAccessories": ["中文可见包装和配件；没有则写参考图未展示包装或配件"],
  "shots": [
    {
      "title": "镜头中文名称",
      "focus": "本张图要展示的唯一重点",
      "prompt": "English prompt for one standalone commercial product detail photograph. State framing, viewpoint, visible product parts, surface, lighting and simple background. Preserve the exact referenced product identity."
    }
  ]
}`;

const SCENE_EXPAND_SYSTEM = `你是专业的电商产品场景摄影策划师。你的任务是读取参考图，锁定产品身份，并按用户指定的数量规划可以分别生成的单张场景图。

工作规则：
1. 参考图是产品身份的唯一权威来源。必须保留产品轮廓、比例、颜色、材质、部件数量与位置、logo、标签和可见文字，不得重新设计产品。
2. 必须输出用户要求的确切场景数量。每个场景是一次独立生图任务，只描述一个地点、一个时刻、一个机位和一张完整照片。
3. 严禁拼图、九宫格、分屏、联系表、分镜板、多面板、前后对比、信息图或在一张图中并列多个场景。
4. 各场景在环境、用途、构图和光线上要有肉眼可见的差异，但产品身份必须完全一致。
5. 每张图以一个主产品为视觉中心。只有参考图明确是多件套装时才允许展示整套，不得无故复制产品。
6. 根据品类合理决定人物出镜。操作型场景只露手和手腕；需要穿戴的产品可展示必要的身体部位；不需要人物时使用纯产品场景。
7. title 和 focus 使用中文；identity 和 prompt 使用具体、可执行的英文摄影描述。
8. 禁止使用 beautiful / amazing / epic / stunning / gorgeous / incredible 等空泛词。

只输出以下 JSON，不要 Markdown 代码块，不要解释：
{
  "productName": "从参考图识别的中文产品名称",
  "identity": "Complete English identity lock covering shape, proportions, colors, materials, components, labels and logo placement",
  "scenes": [
    {
      "title": "场景中文名称",
      "focus": "该场景的唯一用途和画面重点",
      "prompt": "English prompt for exactly one standalone commercial lifestyle product photograph in one coherent location and one camera view. Include environment, product placement or interaction, composition, lighting and color tone."
    }
  ]
}`;

const VIDEO_STORYBOARD_SYSTEM = `角色
你是一位专业的产品广告分镜图生成专家，擅长生成用于AI视频制作的高质量彩色十二宫格（3x4）分镜图提示词。

输入
产品实拍图（用户上传，1-3张）
第一阶段视觉要素描述（文字）
视频主题方向（如：开箱、打包、使用场景等）
所有9格中的产品外观必须严格还原上传的实拍图，包括颜色、形状、材质、logo位置、细节特征。不得自行修改或美化产品外观。

生图要求
风格：彩色写实风格，接近最终视频画面质感；电影级打光，浅景深，暖色调为主；每格画面清晰独立，格与格之间有细黑线分隔；整体色调、光线方向、场景氛围在9格中保持统一。

结构：严格 3列x4行 十二宫格，共 12 格，按从左到右、从上到下的阅读顺序；适配 15 秒短视频，每格约 1.25 秒关键帧。第 6 格和第 7 格是上下半段的衔接帧，画面场景、角度、光线必须一致。

内容模板：
格1 — 开场建立：{{全景或氛围镜头，交代场景，建立情绪}}
格2 — 产品入场：{{产品第一次出现在画面中}}
格3 — 核心动作A：{{与产品的第一次互动，手部特写}}
格4 — 开箱/展示：{{打开包装或展示产品全貌}}
格5 — 细节特写A：{{产品材质/纹理/工艺极近微距}}
格6 — 核心动作B：{{承上启下，与格7同场景}}
格7 — 转场衔接：{{与格6场景一致，新动作开始}}
格8 — 使用场景：{{产品在真实使用环境中}}
格9 — 细节特写B：{{另一个角度的材质/功能特写}}
格10 — 场景变化：{{新场景或新角度展示}}
格11 — 高潮时刻：{{最有视觉冲击力的画面}}
格12 — 收尾定格：{{产品特写，干净收尾}}

硬约束：
产品外观严格参照上传实拍图，不得改变
人物仅露手和手腕，不露脸，肤色服装9格一致
不出现任何文字、logo、水印
格4和格5必须同场景同光线
禁止出现第一阶段指定的禁止元素
生图尺寸：1024×1792（9:16竖屏）

输出
输出中文十二宫格分镜图提示词，可直接复制到生图模型使用。不要加解释。`;



const VIDEO_PROMPT_SYSTEM = `角色
你是产品短视频 prompt 专家。根据用户上传的产品图和文字描述，直接输出可喂给 AI 视频生成模型（Veo、Seedance 等）的英文视频 prompt。

输入
- 产品实拍图（1-3张）
- 用户的文字描述（产品信息、视频主题方向等）

输出要求
- 英文，80-150 词，一段连贯的视频生成 prompt
- 镜头运动放最前面（camera slowly pushes in / tracking shot follows / static close-up 等）
- 用具体动词描述动作（reaches, lifts, rotates, places, slides, unwraps）
- 产品外观严格还原参考图（颜色、形状、材质、细节）
- 人物只露手和手腕，不露脸
- 不出现任何文字、logo、水印
- 视频时长 5-8 秒的单镜头
- 写实风格，电影级打光，浅景深

禁止
- 空泛词：beautiful / amazing / epic / stunning / gorgeous / incredible
- 多镜头切换（一个 prompt 只描述一个连续镜头）
- 解释或分析过程
- 中文

只输出 prompt，不要加任何解释。`;

const VIDEO_REVERSE_SYSTEM_PROMPT = `你是一位专业的视频分析专家。分析提供的视频关键帧图片，反推出一段可以直接用于 AI 视频生成的英文提示词。

分析维度：
1. 主体：人物/产品外观、动作、表情、服装
2. 场景：室内/室外、背景元素、环境氛围
3. 镜头：景别（特写/中景/全景）、角度（平视/俯视/仰视）、运动（推/拉/摇/移/固定）
4. 光线：自然光/人工光、方向、色温、明暗对比
5. 色调：整体色彩倾向、饱和度、对比度
6. 节奏：动作快慢、场景切换频率
7. 产品交互：人与产品的互动方式、产品展示角度

输出要求：
- 英文，80-150 词，一段连贯的视频生成提示词
- 镜头运动放最前面
- 具体动词描述动作（reaches / lifts / rotates / places），不用模糊词
- 禁止空泛词：beautiful / amazing / epic / stunning / gorgeous / incredible
- 只输出提示词，不要解释或分析过程`;

type ChatCompletionResponse = {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
    msg?: string;
    message?: string;
    code?: number;
};

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    const apiKey = config.apiKey.trim();
    return {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
    };
}

function getSystemPrompt(template: PolishTemplate): string {
    switch (template) {
        case "product":
            return PRODUCT_ANALYSIS_SYSTEM;
        case "scene":
            return SCENE_EXPAND_SYSTEM;
        case "storyboard":
            return VIDEO_STORYBOARD_SYSTEM;
        case "videoprompt":
            return VIDEO_PROMPT_SYSTEM;
        case "optimize":
        default:
            return OPTIMIZE_PROMPT_SYSTEM;
    }
}

function imageContent(referenceImages: PolishReferenceImage[]) {
    return referenceImages
        .filter((image) => image.dataUrl)
        .map((image) => ({
            type: "image_url" as const,
            image_url: { url: image.dataUrl },
        }));
}

function readPayloadContent(payload: ChatCompletionResponse, fallback: string) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || payload.message || fallback);
    if (payload.error?.message) throw new Error(payload.error.message);
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error(`${fallback}：模型未返回内容`);
    return content;
}

export async function analyzeProductBreakdown(
    config: AiConfig,
    userPrompt: string,
    model = DEFAULT_POLISH_MODEL,
    referenceImages: PolishReferenceImage[] = [],
): Promise<ProductBreakdownPlan> {
    if (!referenceImages.length) throw new Error("产品拆解至少需要一张产品参考图");
    const requestConfig = resolveModelRequestConfig(config, model || config.textModel || config.model);
    const response = await axios.post<ChatCompletionResponse>(
        aiApiUrl(requestConfig, "/chat/completions"),
        {
            model: requestConfig.model,
            messages: [
                { role: "system", content: PRODUCT_ANALYSIS_SYSTEM },
                {
                    role: "user",
                    content: [
                        {
                            type: "text" as const,
                            text: [
                                `用户补充要求：${userPrompt.trim() || "无，请完全依据参考图进行产品拆解。"}`,
                                `参考图片数量：${referenceImages.length}。这些图片展示同一个产品或同一套产品，请交叉核对产品身份。`,
                                "输出恰好 8 个可独立生成的产品细节镜头。",
                            ].join("\n"),
                        },
                        ...imageContent(referenceImages),
                    ],
                },
            ],
            stream: false,
            max_tokens: 3000,
            temperature: 0.15,
        },
        { headers: aiHeaders(requestConfig) },
    );
    return parseProductBreakdownPlan(readPayloadContent(response.data, "产品拆解失败"));
}

export function formatProductBreakdownPlan(plan: ProductBreakdownPlan) {
    return [
        `### 产品定位\n- 产品名称：${plan.productName}\n- 产品品类：${plan.category}`,
        `### 产品身份锁定\n${plan.identity}`,
        `### 材质与表面\n${plan.materials.map((item) => `- ${item}`).join("\n")}`,
        `### 可见部件\n${plan.components.map((item) => `- ${item}`).join("\n")}`,
        `### 标识与接口\n${plan.visibleMarks.map((item) => `- ${item}`).join("\n")}`,
        `### 包装与配件\n${plan.packageAccessories.map((item) => `- ${item}`).join("\n")}`,
        `### 自动细节图任务\n${plan.shots.map((shot, index) => `${index + 1}. ${shot.title}：${shot.focus}`).join("\n")}`,
    ].join("\n\n");
}

export function buildProductDetailImagePrompt(plan: ProductBreakdownPlan, shot: ProductDetailShot, index?: number) {
    const shotIndex = Math.max(0, index ?? plan.shots.indexOf(shot));
    return [
        "Create one NEW standalone commercial product detail photograph. The supplied images are identity references only, never a base canvas to edit or reproduce.",
        `PRODUCT IDENTITY LOCK: ${plan.identity}`,
        `SHOT: ${shot.prompt}`,
        `PRIMARY FOCUS: ${shot.focus}`,
        `MANDATORY CAMERA AND FRAMING CONTRACT: ${PRODUCT_DETAIL_FRAMING_CONTRACTS[shotIndex % PRODUCT_DETAIL_FRAMING_CONTRACTS.length]}`,
        "Preserve the exact product silhouette, geometry, proportions, part count, part placement, colors, materials, texture, openings, controls, ports, printed labels, and logo placement visible in the references.",
        "Re-photograph the same rigid product with the required new camera viewpoint, crop, orientation, staging, and lighting. Do not redesign, simplify, add, remove, merge, duplicate, bend, stretch, or substitute product parts.",
        "The mandatory framing contract overrides any generic or repetitive framing in the shot description. The result must be visibly different from the other seven shots.",
        "Never return the source image, a near-duplicate, the source crop, the source camera angle, or the source background. Create a new clean product-photography composition on a different neutral background.",
        "No collage, split screen, infographic, callout lines, captions, extra text, watermark, people, hands, or unrelated props.",
        "If a requested accessory, package, interface, or hidden surface is not supported by the reference images, show the closest clearly visible product detail instead of inventing it.",
    ].join("\n");
}


export function buildProductCollagePrompt(plan: ProductBreakdownPlan) {
    const shotDescriptions = plan.shots.map((shot, index) => {
        return `Panel ${index + 1} (${shot.title}): ${shot.prompt}`;
    }).join("\n");

    return [
        "Create a professional multi-angle product detail photography grid for e-commerce. The supplied images are identity references only.",
        `PRODUCT IDENTITY LOCK: ${plan.identity}`,
        "",
        "Layout: A cohesive grid with thin white or dark dividers between panels. Each panel shows the SAME product from a different angle, distance, or context:",
        "",
        shotDescriptions,
        "",
        "STRICT RULES:",
        "- ALL panels must show the exact same product with identical silhouette, colors, materials, proportions, logo placement, and labels visible in the references.",
        "- Professional commercial photography lighting, consistent color temperature across all panels.",
        "- No text overlay, watermark, captions, callout lines, or annotations.",
        "- Each panel must be a complete, standalone photograph within the grid (no cutaway diagrams or technical drawings).",
        "- The grid should read as a professional product catalog page or e-commerce detail showcase.",
        "- Never redesign, simplify, add, remove, merge, duplicate, bend, stretch, or substitute product parts.",
        "- Macro and detail panels must crop the product so the target feature fills at least 70% of that panel.",
    ].join("\n");
}


export function buildSceneCollagePrompt(plan: SceneExpansionPlan) {
    const sceneDescriptions = plan.scenes.map((scene, index) => {
        return `Panel ${index + 1} (${scene.title}): ${scene.prompt}`;
    }).join("\n");

    return [
        "Create a professional multi-scene product lifestyle photography grid for e-commerce. The supplied images are product identity references only.",
        `PRODUCT IDENTITY LOCK: ${plan.identity}`,
        "",
        "Layout: A cohesive grid with thin white or dark dividers between panels. Each panel places the SAME product in a different real-world scene or context:",
        "",
        sceneDescriptions,
        "",
        "STRICT RULES:",
        "- ALL panels must feature the exact same product with identical silhouette, colors, materials, proportions, and branding visible in the references.",
        "- Each panel is a complete lifestyle photograph — the product is naturally placed in its scene, not floating or composited.",
        "- Professional commercial photography lighting appropriate to each scene (natural daylight for outdoor, warm ambient for indoor).",
        "- No text overlay, watermark, captions, callout lines, or annotations.",
        "- No human feet, hands, or body parts unless the product naturally requires being worn.",
        "- The grid should read as a professional product lifestyle showcase or e-commerce detail page.",
        "- Never redesign, simplify, add, remove, merge, or substitute product parts.",
    ].join("\n");
}

export async function analyzeSceneExpansion(
    config: AiConfig,
    userPrompt: string,
    count: number,
    model = DEFAULT_POLISH_MODEL,
    referenceImages: PolishReferenceImage[] = [],
): Promise<SceneExpansionPlan> {
    if (!referenceImages.length) throw new Error("场景扩展至少需要一张产品参考图");
    const sceneCount = Math.max(1, Math.min(10, Math.floor(count) || 1));
    const requestConfig = resolveModelRequestConfig(config, model || config.textModel || config.model);
    const response = await axios.post<ChatCompletionResponse>(
        aiApiUrl(requestConfig, "/chat/completions"),
        {
            model: requestConfig.model,
            messages: [
                { role: "system", content: SCENE_EXPAND_SYSTEM },
                {
                    role: "user",
                    content: [
                        {
                            type: "text" as const,
                            text: [
                                `用户补充要求：${userPrompt.trim() || "无，请根据产品品类规划合理使用场景。"}`,
                                `参考图片数量：${referenceImages.length}。这些图片展示同一产品或同一套产品。`,
                                `必须输出恰好 ${sceneCount} 个互不重复的独立单图场景任务。`,
                            ].join("\n"),
                        },
                        ...imageContent(referenceImages),
                    ],
                },
            ],
            stream: false,
            max_tokens: 3000,
            temperature: 0.25,
        },
        { headers: aiHeaders(requestConfig) },
    );
    return parseSceneExpansionPlan(readPayloadContent(response.data, "场景扩展失败"), sceneCount);
}

export function formatSceneExpansionPlan(plan: SceneExpansionPlan) {
    return [
        `### 产品\n${plan.productName}`,
        `### 产品身份锁定\n${plan.identity}`,
        `### 独立场景图\n${plan.scenes.map((scene, index) => `${index + 1}. ${scene.title}：${scene.focus}`).join("\n")}`,
    ].join("\n\n");
}

export function buildSceneExpansionImagePrompt(plan: SceneExpansionPlan, scene: SceneExpansionShot) {
    return [
        "Create exactly one NEW standalone commercial lifestyle product photograph. The supplied images are identity references only, not a canvas to copy.",
        `PRODUCT IDENTITY LOCK: ${plan.identity}`,
        `SINGLE SCENE: ${scene.prompt}`,
        `PRIMARY PURPOSE: ${scene.focus}`,
        "Render one coherent location, one moment, one camera viewpoint, and one full-frame photograph.",
        "Preserve the exact referenced product silhouette, geometry, proportions, colors, materials, component count and placement, logo, labels, and visible printed text.",
        "Show exactly one primary product unit unless the references clearly depict a multi-item set. Do not duplicate, redesign, simplify, merge, remove, or add product parts.",
        "No collage, grid, nine-panel layout, split screen, contact sheet, storyboard, multi-panel composition, before-and-after layout, inset image, infographic, captions, callout lines, or watermark.",
        "Do not combine multiple locations, times of day, camera angles, or use cases in the same image.",
        "Create a natural scene-specific composition with physically consistent scale, perspective, contact shadows, reflections, lighting direction, and depth of field.",
    ].join("\n");
}

function parseProductBreakdownPlan(content: string): ProductBreakdownPlan {
    const json = extractJsonObject(content);
    let value: unknown;
    try {
        value = JSON.parse(json);
    } catch {
        throw new Error("产品拆解结果格式异常，请重试");
    }
    const record = asRecord(value);
    const identity = requiredString(record.identity, "产品身份");
    const shots = Array.isArray(record.shots)
        ? record.shots
              .map((item, index): ProductDetailShot | null => {
                  const shot = asRecord(item);
                  const prompt = optionalString(shot.prompt);
                  if (!prompt) return null;
                  return {
                      title: optionalString(shot.title) || `细节图 ${index + 1}`,
                      focus: optionalString(shot.focus) || optionalString(shot.title) || `产品细节 ${index + 1}`,
                      prompt,
                  };
              })
              .filter((item): item is ProductDetailShot => Boolean(item))
        : [];
    if (shots.length < 8) throw new Error(`产品拆解只返回了 ${shots.length} 个镜头，需要 8 个，请重试`);
    return {
        productName: requiredString(record.productName, "产品名称"),
        category: requiredString(record.category, "产品品类"),
        identity,
        materials: normalizedStringArray(record.materials, "参考图未明确展示材质"),
        components: normalizedStringArray(record.components, "参考图未明确展示可拆部件"),
        visibleMarks: normalizedStringArray(record.visibleMarks, "无明确可见标识"),
        packageAccessories: normalizedStringArray(record.packageAccessories, "参考图未展示包装或配件"),
        shots: shots.slice(0, 8),
    };
}

function parseSceneExpansionPlan(content: string, count: number): SceneExpansionPlan {
    const json = extractJsonObject(content);
    let value: unknown;
    try {
        value = JSON.parse(json);
    } catch {
        throw new Error("场景扩展结果格式异常，请重试");
    }
    const record = asRecord(value);
    const scenes = Array.isArray(record.scenes)
        ? record.scenes
              .map((item, index): SceneExpansionShot | null => {
                  const scene = asRecord(item);
                  const prompt = optionalString(scene.prompt);
                  if (!prompt) return null;
                  return {
                      title: optionalString(scene.title) || `场景 ${index + 1}`,
                      focus: optionalString(scene.focus) || optionalString(scene.title) || `产品使用场景 ${index + 1}`,
                      prompt,
                  };
              })
              .filter((item): item is SceneExpansionShot => Boolean(item))
        : [];
    if (scenes.length < count) throw new Error(`场景扩展只返回了 ${scenes.length} 个场景，需要 ${count} 个，请重试`);
    return {
        productName: requiredString(record.productName, "产品名称"),
        identity: requiredString(record.identity, "产品身份"),
        scenes: scenes.slice(0, count),
    };
}

function extractJsonObject(content: string) {
    const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("产品拆解未返回可解析结果，请重试");
    return cleaned.slice(start, end + 1);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, label: string) {
    const text = optionalString(value);
    if (!text) throw new Error(`产品拆解缺少${label}，请重试`);
    return text;
}

function normalizedStringArray(value: unknown, fallback: string) {
    const items = Array.isArray(value) ? value.map(optionalString).filter(Boolean) : [];
    return items.length ? items : [fallback];
}

export async function polishPrompt(config: AiConfig, userPrompt: string, mode: PolishMode, template: PolishTemplate = "optimize", model = DEFAULT_POLISH_MODEL, referenceImages: PolishReferenceImage[] = []): Promise<string> {
    const requestConfig = resolveModelRequestConfig(config, model || config.textModel || config.model);
    const promptText = userPrompt.trim() || (mode === "video" || template === "storyboard" ? "请结合参考图片生成九宫格视频分镜提示词。" : "请结合参考图片整理产品视觉要素。");
    const images = imageContent(referenceImages);
    const response = await axios.post<ChatCompletionResponse>(
        aiApiUrl(requestConfig, "/chat/completions"),
        {
            model: requestConfig.model,
            messages: [
                { role: "system", content: getSystemPrompt(template) },
                {
                    role: "user",
                    content: images.length
                        ? [
                              { type: "text" as const, text: `用户需求：${promptText}\n\n参考图片数量：${images.length}。请严格结合参考图片输出中文结果，不要要求用户补充信息。` },
                              ...images,
                          ]
                        : promptText,
                },
            ],
            stream: false,
            max_tokens: 2000,
            temperature: 0.3,
        },
        { headers: aiHeaders(requestConfig) },
    );
    return readPayloadContent(response.data, "润色失败");
}

export async function reverseVideoPrompt(config: AiConfig, frames: Array<{ dataUrl: string; label?: string }>): Promise<string> {
    const requestConfig = resolveModelRequestConfig(config, config.textModel || config.model || DEFAULT_POLISH_MODEL);
    const response = await axios.post<ChatCompletionResponse>(
        aiApiUrl(requestConfig, "/chat/completions"),
        {
            model: requestConfig.model,
            messages: [
                { role: "system", content: VIDEO_REVERSE_SYSTEM_PROMPT },
                { role: "user", content: [{ type: "text", text: `以下是从视频中提取的 ${frames.length} 个关键帧，请分析并反推视频生成提示词。` }, ...imageContent(frames)] },
            ],
            stream: false,
            max_tokens: 1000,
            temperature: 0.3,
        },
        { headers: aiHeaders(requestConfig) },
    );
    return readPayloadContent(response.data, "视频反推失败");
}
