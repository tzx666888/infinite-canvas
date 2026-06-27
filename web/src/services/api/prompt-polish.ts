import axios from "axios";

import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasCommerceVideoPlan } from "@/app/(user)/canvas/types";

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
你是一位电商带货视频分镜规划师，不是影视导演。你的任务是把用户上传的产品图、产品描述或上游产品拆解/场景扩展结果，规划成能服务短视频转化的 CommerceVideoPlan。

核心目标
规划必须回答四个问题：为什么用户会停下来看、为什么用户会继续看、为什么用户会相信产品、为什么用户会点击购买。

分析流程
1. 先分析产品图，只描述可观察到的外观、包装、材质、颜色、使用场景和可能品类。
2. 将信息分为四层：visual_observed（图片可确认）、user_supplied（用户明确提供）、verified_product_data（已验证资料）、unknown（未知，不得编造）。
3. 根据品类匹配钩子类型，内部比较 2-3 种，选择最适合的一种作为 selectedHookType。
4. 钩子类型只能从以下 7 种中选择：contrast、pain-point、visual-shock、counter-intuitive、curiosity、number-impact、before-after。
5. 按 Hook → Pain → Demo → CTA 规划 beats。4s 输出 2 个 beat（hook、cta）；8s 输出 3 个 beat（hook、pain、cta）；12s 输出 4 个 beat（hook、pain、demo、cta）；15s 输出 5-7 个 beat。用户未说明时长时，默认按 15s 输出 5 个 beat。

CommerceVideoPlan JSON 要求
第一段必须输出 markdown JSON 代码块，语言名为 json。JSON 结构必须兼容 CanvasCommerceVideoPlan：
{
  "productCategory": "health-supplement | cleaning | beauty | kitchen | apparel | electronics | home | sports | other",
  "selectedHookType": "contrast | pain-point | visual-shock | counter-intuitive | curiosity | number-impact | before-after",
  "hookDescription": "English hook description",
  "beats": [
    {
      "index": 0,
      "phase": "hook | pain | demo | cta",
      "timeRange": "0-3s",
      "shotType": "close-up | medium | wide | macro | overhead",
      "cameraMove": "static | slow push-in | handheld follow | orbit | tilt down",
      "description": "English visual beat description with concrete subject, action, scene, lighting, camera, style, quality and constraint",
      "eightElements": {
        "subject": "English",
        "action": "English",
        "scene": "English",
        "lighting": "English",
        "camera": "English",
        "style": "English",
        "quality": "English",
        "constraint": "English"
      }
    }
  ],
  "compliance": {
    "mustInclude": ["English compliance note when needed"],
    "mustNotInclude": ["English forbidden claim or visual risk"],
    "riskLevel": "low | medium | high"
  },
  "enhancementWords": "English quality and motion reinforcement words"
}

语言硬约束
- JSON 中 productCategory、hookDescription、beats[].description、beats[].eightElements、compliance、enhancementWords 必须全部使用英文。
- JSON 后面必须追加“中文分镜说明”，每个 beat 用中文解释镜头内容、运镜、注意事项，方便客户阅读修改。

电商转化规则
- Hook 只占 2-3 秒，要高具体性、高视觉差异并且真实，不得通过虚假夸张制造停留。
- Pain 用“具体场景 + 出现频率 + 后果”表达，不能编造疾病、疗效、用户评价。
- Demo 展示产品外观、使用过程、材质、包装、配件或场景价值，只能基于可观察信息和用户提供信息。
- CTA 重复核心利益点和明确动作，但不得编造价格、折扣、库存、认证或专家背书。

合规硬约束
- 保健品、医疗、护理类必须在 compliance.mustInclude 中加入非医疗建议或非治疗承诺提醒。
- 禁止承诺治愈、康复、减肥、变美、永久效果。
- 禁止编造成分、认证、价格、折扣、医生推荐、专家背书、用户评价、Before/After 结果。
- 只描述产品外观和真实使用场景，不推断功效。

禁止
- 禁止空泛词：beautiful / amazing / epic / stunning / gorgeous / incredible。
- 禁止输出固定产品案例。必须根据客户上传的产品图和文字动态生成。
- 禁止直接输出图片 prompt 或把规划写成宫格图说明。这里只输出 CommerceVideoPlan JSON + 中文分镜说明；画布会基于 JSON 另行生成 12 宫格候选图和干净关键帧。`;



const VIDEO_PROMPT_SYSTEM = `角色
你是视频生成提示词专家，负责把产品描述、参考图说明、分镜规划或 CommerceVideoPlan JSON 编译成 Grok 可直接使用的英文视频 prompt。

输入
- 客户的产品描述、视频目标或自由文本
- 可能包含 CommerceVideoPlan JSON，也可能只是普通中文说明
- 可能包含参考图、关键帧、产品图或场景图
- 如果参考图是带编号的宫格/分镜候选图，把每个编号面板当作顺序镜头；最终视频必须是干净全屏镜头，不得出现宫格边框、编号、拼图版式或分镜页

输出格式
只输出 Grok 版本：

## Grok Version
输出 100-180 词英文单段 prompt。不要分段，不要时间轴。用逗号、then、while、as 连接成一条连续主线。强调主体一致、动作连续、物理真实、镜头跟随自然。

编写规则
- 所有视觉描述必须具体：主体、动作、场景、光影、镜头、风格、画质、约束都要明确。
- Grok 适合简洁连续单主线，不要写时间轴分段。
- 4s 只保留 hook + cta；8s 加 pain；12s 加 demo；15s 使用完整 Hook → Pain → Demo → CTA 节奏。
- 如果输入包含参考图，追加保真约束：Maintain visual continuity with the reference image, preserve subject appearance, color palette, product shape, label placement, and composition.
- 如果输入包含12宫格或分镜候选图，追加：Use the numbered storyboard panels as shot-order guidance only; recreate them as clean full-frame shots and never show the grid, panel borders, labels, or collage layout.
- 如果输入明显是参考视频或动作序列，追加：Use the reference video as motion and rhythm guidance, preserve the subject and key visual elements from the reference frames.
- 9:16 竖屏：主体居中偏上，避免裁切头脚或产品边缘。
- 16:9 横屏：保留环境空间，让场景关系清楚。
- 1:1 方图：主体居中，构图紧凑，避免空白过多。
- 尾部追加强化词：4K ultra HD, cinematic quality, natural body proportions, smooth continuous motion, no frame skipping, consistent appearance throughout.
- 末尾追加 Negative prompt：no storyboard labels, no arrows, no grid, no captions, no watermark, no distorted hands, no extra limbs, no unreadable product labels, no false medical claims.

合规约束
- 保健品、医疗、护理类不得承诺治疗、康复、减肥、变美或永久效果。
- 不得编造成分、认证、价格、折扣、医生推荐、专家背书、用户评价。
- 只能使用用户明确提供或图中可观察的信息。

禁止
- 禁止空泛词：beautiful / amazing / epic / stunning / gorgeous / incredible。
- 禁止输出中文视频 prompt。
- 禁止解释分析过程，只输出 Grok Version。`;

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

const STORYBOARD_REVIEW_MOMENTS = [
    "opening visual hook",
    "product identity close read",
    "problem or desire setup",
    "context reveal",
    "action start",
    "main product demonstration",
    "detail proof point",
    "lifestyle usage moment",
    "benefit visualization",
    "decision moment",
    "offer or CTA setup",
    "final hero frame",
] as const;

function storyboardReviewFrames(plan: CanvasCommerceVideoPlan, totalPanels = 12) {
    const beats = [...(plan.beats || [])].sort((a, b) => a.index - b.index);
    if (!beats.length) {
        return Array.from({ length: totalPanels }, (_, index) => `Panel ${index + 1}: ${STORYBOARD_REVIEW_MOMENTS[index % STORYBOARD_REVIEW_MOMENTS.length]}.`);
    }

    return Array.from({ length: totalPanels }, (_, index) => {
        const beatIndex = Math.min(beats.length - 1, Math.floor((index / totalPanels) * beats.length));
        const beat = beats[beatIndex];
        const el = beat.eightElements;
        const detail = [el?.subject, el?.action, el?.scene, el?.lighting, el?.camera, el?.style, el?.constraint].filter(Boolean).join(", ") || beat.description;
        return `Panel ${index + 1}: Beat ${beat.index} ${beat.phase} (${beat.timeRange || "planned timing"}), ${STORYBOARD_REVIEW_MOMENTS[index % STORYBOARD_REVIEW_MOMENTS.length]}. ${detail}`;
    });
}

export function buildStoryboardReviewSheetPrompt(plan: CanvasCommerceVideoPlan, variantIndex = 1): string {
    const variantNotes = [
        "Variant direction: balanced commercial rhythm, clear product readability, practical e-commerce conversion flow.",
        "Variant direction: stronger visual hook and faster camera rhythm while keeping product identity accurate.",
        "Variant direction: more lifestyle context and warmer human-use moments while keeping claims realistic.",
        "Variant direction: cleaner studio/product-proof style with sharper detail frames and a confident CTA.",
    ];
    return [
        "Create ONE strict 12-frame storyboard contact sheet for an e-commerce short video.",
        "The top priority is geometry: exactly 3 columns x 4 rows, exactly 12 equal rectangular panels, clear dark panel dividers, no missing cells, no merged cells, no hero panel.",
        "Each panel must be a separate full-bleed video thumbnail. The result must look like a storyboard sheet, not a product poster, not an advertising banner, not a collage with unequal blocks.",
        "This image is for human review and selection before video generation. It is not a final video frame.",
        `Product category: ${plan.productCategory || "e-commerce product"}.`,
        plan.hookDescription ? `Hook strategy: ${plan.hookDescription}.` : "",
        plan.enhancementWords ? `Shared style and quality: ${plan.enhancementWords}.` : "",
        variantNotes[(Math.max(1, variantIndex) - 1) % variantNotes.length],
        "Panel plan:",
        ...storyboardReviewFrames(plan).map((line) => `- ${line}`),
        "Rules:",
        "- Preserve one consistent product identity, packaging, colors, materials, logo placement, scale, and lighting logic across all panels.",
        "- Show 12 visibly different storyboard moments, not one repeated image and not fewer than 12 panels.",
        "- Do not add poster headlines, Chinese marketing slogans, CTA banners, big title text, dense captions, callout arrows, UI chrome, or watermark. Small corner numbers 1-12 are allowed only if they do not replace the images.",
        "- Keep all claims visually conservative and realistic. Do not invent certifications, prices, discounts, medical effects, user reviews, or impossible before/after results.",
        "- Output a single vertical 12-panel storyboard sheet. If there is any ambiguity, prefer a clean 3x4 grid over decorative advertising design.",
    ].filter(Boolean).join("\n");
}

export function buildStoryboardKeyframePrompt(
    plan: { productCategory?: string; enhancementWords?: string },
    beat: {
        index: number;
        phase: string;
        shotType?: string;
        cameraMove?: string;
        description: string;
        eightElements?: {
            subject?: string; action?: string; scene?: string; lighting?: string;
            camera?: string; style?: string; quality?: string; constraint?: string;
        };
    },
    options: { selectedReviewSheet?: boolean } = {},
): string {
    const parts: string[] = [];
    const el = beat.eightElements;
    if (el?.subject) {
        const elements = [el.subject, el.action, el.scene, el.lighting, el.camera, el.style, el.quality].filter(Boolean);
        parts.push(elements.join(", ") + ".");
        if (el.constraint) parts.push(el.constraint + ".");
    } else {
        parts.push(beat.description);
    }
    if (plan.enhancementWords) parts.push(plan.enhancementWords);
    if (options.selectedReviewSheet) parts.push("If a selected 12-panel storyboard review sheet is supplied as a reference, use only the matching panel's composition, continuity and visual direction as guidance.");
    parts.push("4K ultra HD, sharp focus, smooth motion, consistent appearance.");
    parts.push("No storyboard labels, no arrows, no grid panels, no captions, no watermark, no distorted hands.");
    return parts.join(" ");
}

export function formatCommerceVideoPlan(plan: CanvasCommerceVideoPlan): string {
    const lines: string[] = [];
    lines.push("# 视频分镜规划\n");
    if (plan.productCategory) lines.push(`品类：${plan.productCategory}`);
    if (plan.selectedHookType) lines.push(`钩子类型：${plan.selectedHookType}`);
    if (plan.hookDescription) lines.push(`钩子描述：${plan.hookDescription}`);
    lines.push("");
    if (plan.beats?.length) {
        for (const beat of plan.beats) {
            const phaseLabel: Record<string, string> = { hook: "Hook", pain: "Pain", demo: "Demo", cta: "CTA" };
            lines.push(`## Beat ${beat.index} | ${phaseLabel[beat.phase] || beat.phase} | ${beat.timeRange}`);
            if (beat.shotType) lines.push(`景别：${beat.shotType}`);
            if (beat.cameraMove) lines.push(`运镜：${beat.cameraMove}`);
            lines.push(`描述：${beat.description}`);
            lines.push("");
        }
    }
    if (plan.compliance) {
        lines.push("## 合规提醒");
        plan.compliance.mustInclude?.forEach((note) => lines.push(`- ✅ ${note}`));
        plan.compliance.mustNotInclude?.forEach((note) => lines.push(`- ❌ ${note}`));
        if (plan.compliance.riskLevel) lines.push(`风险等级：${plan.compliance.riskLevel}`);
    }
    return lines.join("\n");
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
    const promptText = userPrompt.trim() || (mode === "video" || template === "storyboard" ? "请结合参考图片生成电商短视频分镜规划，后续用于12宫格候选图。" : "请结合参考图片整理产品视觉要素。");
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
