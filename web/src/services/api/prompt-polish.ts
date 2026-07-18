import axios from "axios";

import { compileVideoWorkbenchPrompt, hasWorkbenchSpokenScript, requestsNoSpeech, workbenchShotCount, workbenchSpeechWordRange, type VideoWorkbenchPromptContext } from "@/lib/video-workbench-prompt";
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

const DEFAULT_POLISH_MODEL = "tokaxis::gpt-5.6-sol";
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
7. 禁止使用 beautiful / amazing / epic / stunning / gorgeous / incredible 这类空泛词
8. 禁止未成年人性化、明确裸露或色情、血腥暴力、仇恨歧视、违法行为；禁止虚假价格、折扣、认证、医疗功效、水印、乱码文字、畸形手指、畸形人脸和产品变形`;

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
9. 禁止未成年人性化、明确裸露或色情、血腥暴力、仇恨歧视、违法行为；禁止虚假价格、认证、医疗功效、水印、乱码文字、人物或产品变形。

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
9. 禁止未成年人性化、明确裸露或色情、血腥暴力、仇恨歧视、违法行为；禁止虚假价格、认证、医疗功效、水印、乱码文字、畸形手指、畸形人脸和产品变形。

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
你是一位以参考素材为唯一事实来源的短视频分镜规划师。用户可能上传独立商品、穿戴服饰、人物主体或纯场景；不得把所有素材都强行解释成包装商品或清洁类带货。

第一原则：先分类，再规划
1. 先把素材归为 storyboardMode：product（独立商品）、apparel（人物身上的服装/配饰本身是商品）、subject（人物/动物/角色主体）、scene（环境或事件场景）。
2. visualIdentity 只锁定参考图中肉眼可确认的人物/主体身份、服装或商品、颜色和关键结构。环境变化写入 beats，不得把首张参考图的地点永久锁死。看不清的文字和物体不得猜测。
3. forbiddenAdditions 明确列出最容易被误加的无关实体。若参考图和用户要求没有独立商品，必须禁止新增瓶子、包装、喷雾、清洁剂、工具、logo 或其他商品。
4. 参考图、用户文字和当前 beats 是人物、商品、服装和道具的唯一内容来源。apparel / subject 可规划与素材语义一致的相关地点变化，但不得借用固定案例、历史任务或其他品类的实体和动作。
5. 用户文字是绑定的导演要求。用户明确写出的时长、地点、地点顺序、人物、服装、禁用项和剪辑方式，必须逐项保留，不得为了贴近首张参考图而缩小、合并、替换或删除。参考图锁身份和可见实体，不锁死用户明确要求变化的环境。

规划规则
1. 将信息分为 visual_observed（图片可确认）、user_supplied（用户明确提供）、verified_product_data（已验证资料）、unknown（未知，不得编造）。
2. 内部比较 2-3 种开场，只选择与素材相符的钩子。钩子类型只能是 contrast、pain-point、visual-shock、counter-intuitive、curiosity、number-impact、before-after。
3. product 模式可按 Hook → Pain → Demo → CTA，但痛点、操作和商品必须确实存在于素材或用户要求中，禁止默认添加污渍、喷洒、擦拭、泡沫或前后对比。
4. apparel 模式默认使用 lifestyle-montage：服装本身就是商品，锁定同一成年人物、脸、发型、服装设计、覆盖范围和身体比例；15s 计划应在 3-5 个语义相关地点间推进，例如同一度假区、同一城市路线或同一住宅的不同区域。绝不新增包装商品、瓶子、清洁动作或救场道具。
5. subject 模式默认使用 cinematic-subject：围绕同一主体形成强开场、动作推进和视觉收束，可在 2-4 个相关地点间用干净剪辑切换，不强制商品、购买动作或问题解决。
6. scene 模式使用 scene-progression：环境和事件可以在同一视觉世界内推进，不得突然跳到无关地点或加入无关人物/商品。
7. product 模式默认 storyboardStyle=direct-response、locationStrategy=single-location；apparel / subject 默认 locationStrategy=related-location-montage。用户明确要求单一地点时必须尊重。
8. 4s 输出 2 个 beat；8s 输出 3 个 beat；12s 输出 4 个 beat；15s 输出 5-7 个 beat。用户未说明时长时，默认按 15s 输出 5 个 beat。
9. 每个 beat 必须按时间顺序推进。同一人物、服装和商品身份始终一致；环境可以按 beats 中明确规划的相关地点变化。相邻 beat 必须在动作、景别、机位或地点上有肉眼可见的推进，不得只做轻微换角度。
10. plannedLocations 必须列出计划实际使用的英文地点。若用户点名多个地点，必须包含每个地点的准确英文语义，并在 beats 中按用户顺序覆盖全部地点；禁止把 beach、poolside、resort lounger、tropical waterfall 等不同地点概括成一个 shoreline 或同一背景。
11. 电商视频默认需要可听见的口播，只有用户明确要求无声、纯音乐或环境音时才使用 ambient-only。口播必须只说素材可见信息和用户提供的事实，不得编造功效、价格、折扣、认证、销量或品牌文字。
12. audioPlan.scriptsByDuration 必须分别提供 6s、10s、15s 三份独立口播稿：英文分别为 7-10、12-16、18-22 词，其他语言使用等价口播节奏；不得把长稿机械截断成短稿。这些是为 Grok 真人口播预留停顿、呼吸和清晰发音的上限，不要为了填满时长而增加口号或功能清单。audioPlan.script 必须等于用户目标时长对应版本，未指定时长则使用 15s 版本。每份稿都只演绎一次，像真人创作者自然说话：第一句是 4-7 词的即时反应或观察，短暂停顿后用第二句连贯说完一个利益点或邀请。禁止写“from the first ... to the final ...”式导演语言、镜头顺序说明、服装几何清单、堆叠功能碎句或逐 beat 新口号。
13. apparel / subject 有可见成年人物且用户未指定纯画外音时，默认 audioPlan.mode=mixed：优先把第一句放在一个稳定的正脸中近景作为自然口播，随后同一声线转为画外音覆盖动作、环境、商品和细节 B-roll；不得让人物在每次剪辑后重新开口。只有用户明确要求全程面对镜头口播时才使用 on-camera。人物开口时保持同一张脸、完整头部和嘴部可见，并自然同步口唇、下颌、呼吸及表情；纯商品特写、局部材质、背身和无脸镜头的 spokenLine 必须为空。

CommerceVideoPlan JSON 要求
第一段必须输出 markdown JSON 代码块，语言名为 json。JSON 结构必须兼容 CanvasCommerceVideoPlan：
{
  "productCategory": "health-supplement | cleaning | beauty | kitchen | apparel | electronics | home | sports | person | scene | other",
  "storyboardMode": "product | apparel | subject | scene",
  "storyboardStyle": "direct-response | lifestyle-montage | cinematic-subject | scene-progression",
  "locationStrategy": "single-location | related-location-montage",
  "plannedLocations": ["English location names in exact narrative order; preserve every user-specified location"],
  "visualIdentity": "English identity lock for the subject, garment or product based only on visible references and user-supplied facts; do not lock the first location here",
  "forbiddenAdditions": ["English names of unrelated entities or actions that must never appear"],
  "selectedHookType": "contrast | pain-point | visual-shock | counter-intuitive | curiosity | number-impact | before-after",
  "hookDescription": "English hook description",
  "audioPlan": {
    "mode": "voiceover | on-camera | mixed | ambient-only",
    "language": "Spoken language requested by the user, otherwise English",
    "voice": "One concise consistent adult voice direction matching the visible lead when applicable",
    "script": "Complete script matching the requested duration, or an empty string only for ambient-only",
    "scriptsByDuration": {
      "6": "Independent natural 6-second script in the target spoken language",
      "10": "Independent natural 10-second script in the target spoken language",
      "15": "Independent natural 15-second script in the target spoken language"
    }
  },
  "beats": [
    {
      "index": 0,
      "phase": "hook | pain | demo | cta",
      "timeRange": "0-3s",
      "shotType": "close-up | medium | wide | macro | overhead",
      "cameraMove": "static | slow push-in | handheld follow | orbit | tilt down",
      "description": "English visual beat description using only the referenced subject, action, scene and allowed objects",
      "spokenLine": "Exact short line spoken during this beat in the target spoken language; use an empty string when this beat has no speech",
      "eightElements": {
        "subject": "English",
        "action": "English",
        "scene": "English",
        "lighting": "English",
        "camera": "English",
        "style": "English",
        "quality": "English",
        "constraint": "English identity and no-new-entity constraint"
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
- JSON 中除 audioPlan.script、audioPlan.scriptsByDuration 和 beats[].spokenLine 外的所有描述字段必须使用英文。这些口播字段必须使用 audioPlan.language 指定的目标语言。
- JSON 后面必须追加“中文分镜说明”，逐个 beat 解释镜头、运镜和身份约束。
- 输出前逐项核对用户要求。用户点名 N 个地点时，plannedLocations 必须有 N 个对应地点且 beats 必须全部覆盖；不满足时先自行修正再输出。

合规硬约束
- 禁止未成年人性化、明确裸露或色情、血腥暴力、仇恨歧视和违法行为。
- 保健品、医疗、护理类禁止承诺治疗、康复、减肥、变美或永久效果。
- 禁止编造成分、认证、价格、折扣、销量、医生推荐、专家背书、用户评价或不可能的前后对比。
- 只描述图中可观察信息和用户明确提供的信息。

禁止
- 禁止空泛词：beautiful / amazing / epic / stunning / gorgeous / incredible。
- 禁止输出固定产品案例，禁止从其他任务串入商品、人物、道具、场景或动作。
- 禁止直接输出宫格图片 prompt。这里只输出 CommerceVideoPlan JSON + 中文分镜说明；画布会基于 JSON 生成 12 宫格候选图。`;

export const VIDEO_PROMPT_SYSTEM = `角色
你是参考素材驱动的短视频提示词专家。你的任务是写出一段简洁、可直接交给 Grok Fast 的英文视频提示词，风格必须像专业导演给生成模型的拍摄指令，而不是复述分镜表或堆砌模型约束。

输出硬格式
- 只输出 100-160 个英文单词、一个自然段，不要标题、列表、时间轴、JSON 或解释。
- 第一处内容必须是具体运镜，例如 slow dolly-in、steady close-up、low-angle push-in、handheld follow 或 smooth tracking shot；随后再写场景和动作。
- 先判断素材属于 product、apparel、subject 或 scene，再使用 5-7 个清楚的镜头动作。product 按 opening hook → use/detail → proof/result → product finish 推进；apparel / subject 按 visual hook → movement → related-location progression → hero payoff 推进；scene 按 establish → event progression → resolving view 推进。
- 宫格或分镜图只用于在内部理解故事顺序。选择最关键的镜头，不要逐格复述全部面板。
- 只使用参考素材和用户文字中真实出现的人物、商品、服装与道具。保持同一人物、服装设计、商品形状、主色、标签位置和数量一致，不新增其他商品或包装。
- apparel / subject 可以在同一生活方式世界内切换 3-5 个语义相关地点，例如相连的度假区、城市路线或住宅区域；必须用干净剪辑，并保持同一人物和服装。除非用户要求单一地点，不要让所有镜头停留在几乎相同的背景和构图。
- 人物只在故事需要时出现；产品特写、操作特写和结果镜头保持干净，不让人物与商品发生变形过渡。

禁止写入最终提示词的模板废话
- 不要提 reference image、storyboard、grid、panel、visual continuity 或模型如何读取参考图。
- 不要追加 4K ultra HD、cinematic quality、smooth continuous motion、no frame skipping 等通用质量词串。
- 不要写 Negative prompt，也不要追加一长串 no ... 禁止项。必要约束应自然融入对应镜头。
- 不要使用 beautiful / amazing / epic / stunning / gorgeous / incredible 等空泛词。
- 不要编造价格、折扣、认证、医疗功效、品牌文字或看不清的标签内容。

最终检查
输出应当像“运镜开头 + 场景中的连续关键动作 + 清楚的产品/结果收尾”的短版导演提示词。只输出英文提示词正文。`;

const VIDEO_WORKBENCH_SYSTEM = `你是电商短视频创作台的智能编导。你必须同时读取用户要求、参考图、目标模型、参考模式和时长，输出一段可直接交给 Grok 视频模型的英文导演指令。

硬规则：
- 只输出 60-85 个英文单词左右的一个自然段，不要标题、列表、JSON、解释或 Negative prompt。把篇幅留给明确的镜头动作和完整口播，不要重复通用安全约束。
- 先根据参考图锁定真实可见的成年人物、服装、商品、场景和尺寸关系；不得编造参考图中不存在的人物或商品。
- 画面编排只使用输入中的实体。人体、脸、手、服装和商品从第一帧起就必须稳定；商品是独立的刚性物体，不与身体或服装融合。
- i2v 必须从首张图的精确构图开始，r2v 必须把各张图作为分工明确的身份/商品/场景素材，用干净硬切连接，不能把多张图熔成一个变形镜头。
- 按用户语言或其明确指定的市场语言生成口播，不翻译商品上的品牌文字。

真人带货模式：
- 除非用户明确要求无口播，否则必须生成清晰、自然、像真实创作者的口播，不得生成沉默或只有音乐的视频。
- 口播必须是一个连贯想法，先是 4-7 个词的自然反应/勾子，一次呼吸后给出一个可见的使用价值和轻柔收尾；不念功能清单，不念镜头说明。
- 必须原样输出这个字段：Spoken script: "可直接说出的完整口播"。引号内只有台词，不得包含动作或镜头指令。
- 有真人时，开头先给同一主播一个稳定的脸部可见中景/近景，只说第一个短句；后续产品特写由同一声音做画外音。只在嘴巴清晰可见时做口型。
- 无真人时用同一个自然画外音，不凭空生成主播。

自由创作模式：
- 忠实保留用户是否需要对话、画外音、环境音或静音的选择，不自动改成广告。

合规：
- 不编造价格、折扣、认证、医疗效果、销量、用户证言、品牌文字或看不清的标签内容。`;

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
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
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

const VIDEO_PROMPT_BOILERPLATE_MARKERS = [
    "Maintain visual continuity with the reference image",
    "Use the storyboard grid as ordered shot guidance only",
    "Use the numbered storyboard panels",
    "Use the reference video as motion and rhythm guidance",
    "4K ultra HD",
    "Negative prompt:",
] as const;

export function normalizeGeneratedVideoPrompt(raw: string) {
    const grokVersion = raw.match(/##\s*Grok Version\s*\n([\s\S]*?)(?=\n##\s|$)/i)?.[1] || raw;
    let prompt = grokVersion
        .replace(/^\s*(?:Grok Version\s*:?\s*)/i, "")
        .replace(/\s+/g, " ")
        .trim();
    const markerIndex = VIDEO_PROMPT_BOILERPLATE_MARKERS.reduce((earliest, marker) => {
        const index = prompt.toLowerCase().indexOf(marker.toLowerCase());
        return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
    }, -1);
    if (markerIndex >= 0) prompt = prompt.slice(0, markerIndex).trim();
    return prompt.replace(/[\s,;:—-]+$/, "").trim();
}

export async function optimizeVideoWorkbenchPrompt(config: AiConfig, context: VideoWorkbenchPromptContext, referenceImages: PolishReferenceImage[] = [], model = DEFAULT_POLISH_MODEL) {
    const requestConfig = resolveModelRequestConfig(config, model);
    const [minimumWords, maximumWords] = workbenchSpeechWordRange(context.duration);
    const shotCount = workbenchShotCount(context.duration);
    const silent = requestsNoSpeech(context.sourcePrompt);
    const images = imageContent(referenceImages);
    const userText = [
        `User request: ${context.sourcePrompt}`,
        `Creation mode: ${context.mode === "commerce" ? "real-person ecommerce creator video" : "free creative video"}.`,
        `Target video model: ${context.model}.`,
        `Target duration: ${context.duration} seconds; aspect ratio: ${context.aspectRatio}; reference mode: ${context.referenceMode}.`,
        `Use exactly ${shotCount} readable story stages joined by clean edits.`,
        context.mode === "commerce" && !silent
            ? `The Spoken script must fit the duration: ${minimumWords}-${maximumWords} words for a space-delimited language, or an equivalent natural speaking length for Chinese/Japanese/Korean. It must sound spontaneous, warm, and conversational.`
            : "Respect the user's requested audio treatment. Do not force advertising speech in free-creative mode.",
        `There are ${images.length} attached reference images in the same order shown to the user. Analyze them internally, but do not mention references, image numbers, model names, or prompt-writing instructions in the output.`,
    ].join("\n");
    const response = await fetch(aiApiUrl(requestConfig, "/chat/completions"), {
        method: "POST",
        headers: { ...aiHeaders(requestConfig), Accept: "text/event-stream" },
        body: JSON.stringify({
            model: requestConfig.model,
            messages: [
                { role: "system", content: VIDEO_WORKBENCH_SYSTEM },
                {
                    role: "user",
                    content: images.length ? [{ type: "text" as const, text: userText }, ...images] : userText,
                },
            ],
            stream: true,
            max_tokens: 900,
            temperature: 0.25,
        }),
    });
    if (!response.ok) throw new Error(await readVideoWorkbenchPromptError(response));
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    const content = contentType.includes("text/event-stream") ? await collectVideoWorkbenchPromptStream(response) : readPayloadContent((await response.json()) as ChatCompletionResponse, "视频智能编导失败");
    const direction = content
        .replace(/^```(?:text)?\s*/i, "")
        .replace(/\s*```$/, "")
        .replace(/\s+/g, " ")
        .trim();
    if (context.mode === "commerce" && !silent && !hasWorkbenchSpokenScript(direction)) {
        throw new Error("视频智能编导未生成完整口播，请重试");
    }
    return compileVideoWorkbenchPrompt(direction, context);
}

async function collectVideoWorkbenchPromptStream(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("视频智能编导失败：无响应流");
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
        let payload: ChatCompletionResponse;
        try {
            payload = JSON.parse(dataText) as ChatCompletionResponse;
        } catch {
            return;
        }
        if (payload.error?.message) throw new Error(payload.error.message);
        if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || payload.message || "视频智能编导失败");
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
    if (!content.trim()) throw new Error("视频智能编导失败：模型未返回内容");
    return content.trim();
}

async function readVideoWorkbenchPromptError(response: Response) {
    const fallback = `视频智能编导失败 (${response.status})`;
    const text = await response.text().catch(() => "");
    if (!text.trim()) return fallback;
    try {
        const payload = JSON.parse(text) as ChatCompletionResponse;
        return payload.error?.message || payload.msg || payload.message || fallback;
    } catch {
        return text.slice(0, 300) || fallback;
    }
}

export async function analyzeProductBreakdown(config: AiConfig, userPrompt: string, model = DEFAULT_POLISH_MODEL, referenceImages: PolishReferenceImage[] = []): Promise<ProductBreakdownPlan> {
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
    const shotDescriptions = plan.shots
        .map((shot, index) => {
            return `Panel ${index + 1} (${shot.title}): ${shot.prompt}`;
        })
        .join("\n");

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
    const sceneDescriptions = plan.scenes
        .map((scene, index) => {
            return `Panel ${index + 1} (${scene.title}): ${scene.prompt}`;
        })
        .join("\n");

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

export async function analyzeSceneExpansion(config: AiConfig, userPrompt: string, count: number, model = DEFAULT_POLISH_MODEL, referenceImages: PolishReferenceImage[] = []): Promise<SceneExpansionPlan> {
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
    return [`### 产品\n${plan.productName}`, `### 产品身份锁定\n${plan.identity}`, `### 独立场景图\n${plan.scenes.map((scene, index) => `${index + 1}. ${scene.title}：${scene.focus}`).join("\n")}`].join("\n\n");
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

const PRODUCT_STORYBOARD_REVIEW_MOMENTS = [
    "open with the assigned beat's strongest reference-supported visual hook",
    "show the exact product or use context in a wider readable composition",
    "move into a decisive product, material, or problem detail without inventing claims",
    "begin the assigned physical action with a clear hand, tool, or product relationship only when supported",
    "show the next physically plausible instant of the assigned use or construction detail",
    "change camera height and shot size while keeping the exact product geometry stable",
    "show a believable proof, texture, mechanism, or result already described by the beat",
    "reconnect the exact product with its real use environment in a medium or wide shot",
    "advance the ordered action with a visibly different composition",
    "hold a clean product-forward moment without adding packaging or offers",
    "show the final beat's result or reassurance from a fresh angle",
    "finish with the same product in a strong, truthful resolving frame",
] as const;

const LIFESTYLE_STORYBOARD_REVIEW_MOMENTS = [
    "open on the strongest face, silhouette, garment, or subject motion hook from the assigned beat",
    "show a dynamic full-body or wider entrance with the same identity and wardrobe",
    "use a tracking, follow, or lateral camera move that gives the subject clear direction",
    "move into a precise face, garment, material, hand, or movement detail",
    "cut cleanly to the next related location explicitly planned by the assigned beat",
    "show a natural turn, walk, reach, pose change, or environmental interaction already supported by the beat",
    "use a low, high, rear three-quarter, or side angle while preserving face, anatomy, and wardrobe",
    "reveal more of the related environment with a wide shot and active foreground or background depth",
    "capture the next energetic action instant with believable hair, fabric, water, wind, or body motion only when present",
    "slow briefly into a composed medium portrait or identity-preserving lifestyle moment",
    "advance into the final related location or strongest payoff composition from the ordered beats",
    "finish with a confident full-body or subject hero frame that resolves the final beat",
] as const;

const SCENE_STORYBOARD_REVIEW_MOMENTS = [
    "establish the assigned environment with a strong readable opening composition",
    "move closer to the event or environmental detail that drives the assigned beat",
    "show the first visible change in weather, light, activity, or camera position",
    "use a new camera height or direction to reveal spatial relationships",
    "advance the event by one physically plausible step",
    "show a tight atmospheric or action detail without importing new entities",
    "return to a medium or wide frame that reconnects the event and environment",
    "cut to the next related zone explicitly described by the ordered beat",
    "increase motion, depth, or visual tension through the planned event",
    "hold a clear environmental payoff from a fresh angle",
    "show a calm resolving variation within the same visual world",
    "finish the final assigned beat with a coherent closing view",
] as const;

function storyboardReviewMoments(plan: CanvasCommerceVideoPlan): readonly string[] {
    const mode = resolveStoryboardMode(plan);
    if (mode === "apparel" || mode === "subject") return LIFESTYLE_STORYBOARD_REVIEW_MOMENTS;
    if (mode === "scene") return SCENE_STORYBOARD_REVIEW_MOMENTS;
    return PRODUCT_STORYBOARD_REVIEW_MOMENTS;
}

function beatForStoryboardPanel(beats: NonNullable<CanvasCommerceVideoPlan["beats"]>, panelIndex: number, totalPanels: number) {
    const beatIndex = Math.min(beats.length - 1, Math.floor((panelIndex * beats.length) / Math.max(1, totalPanels)));
    return beats[beatIndex];
}

function storyboardReviewFrames(plan: CanvasCommerceVideoPlan, totalPanels = 12) {
    const beats = [...(plan.beats || [])].sort((a, b) => a.index - b.index);
    const moments = storyboardReviewMoments(plan);
    if (!beats.length) {
        return Array.from({ length: totalPanels }, (_, index) => `Hidden storyboard instruction: ${moments[index % moments.length]}.`);
    }

    return Array.from({ length: totalPanels }, (_, index) => {
        const beat = beatForStoryboardPanel(beats, index, totalPanels);
        const el = beat.eightElements;
        const detail = [el?.subject, el?.action, el?.scene, el?.lighting, el?.camera, el?.style, el?.constraint].filter(Boolean).join(", ") || beat.description;
        return `Hidden storyboard instruction: ${moments[index % moments.length]}. Follow beat ${beat.index} (${beat.phase}) in chronological order. ${detail}. Do not add any person, product, package, prop, brand, tool, garment, or action that is absent from the references and this beat.`;
    });
}

function resolveStoryboardMode(plan: CanvasCommerceVideoPlan): NonNullable<CanvasCommerceVideoPlan["storyboardMode"]> {
    if (plan.storyboardMode === "product" || plan.storyboardMode === "apparel" || plan.storyboardMode === "subject" || plan.storyboardMode === "scene") {
        return plan.storyboardMode;
    }
    const category = (plan.productCategory || "").trim().toLowerCase();
    if (category === "apparel" || category.includes("clothing") || category.includes("fashion")) return "apparel";
    if (category === "person" || category === "portrait" || category === "character") return "subject";
    if (category === "scene" || category === "landscape" || category === "environment") return "scene";
    return "product";
}

function resolveLocationStrategy(plan: CanvasCommerceVideoPlan): NonNullable<CanvasCommerceVideoPlan["locationStrategy"]> {
    if (plan.locationStrategy === "single-location" || plan.locationStrategy === "related-location-montage") return plan.locationStrategy;
    const mode = resolveStoryboardMode(plan);
    return mode === "product" ? "single-location" : "related-location-montage";
}

function storyboardModeRules(plan: CanvasCommerceVideoPlan) {
    const mode = resolveStoryboardMode(plan);
    const locationStrategy = resolveLocationStrategy(plan);
    const plannedLocations = (plan.plannedLocations || []).map((location) => location.trim()).filter(Boolean);
    const locationRule =
        locationStrategy === "single-location"
            ? "LOCATION STRATEGY: single-location. Keep one coherent environment, but make shots visibly different through action, framing, camera height, and depth."
            : `LOCATION STRATEGY: related-location-montage. Use every related location explicitly planned in the ordered beats${plannedLocations.length ? `, specifically and without substitution: ${plannedLocations.join(" -> ")}` : ""}; for a 15-second apparel or subject montage, aim for at least three distinct but coherent location zones. Change locations only with clean cuts and never change the subject identity or wardrobe.`;
    if (mode === "apparel") {
        return [
            "MODE LOCK: apparel. The garment or accessory already worn by the referenced person is the product; preserve the same adult person, face, hair, garment design, coverage, colors, material, and body proportions across every panel.",
            locationRule,
            "Never add a separate packaged product, bottle, spray trigger, cleaner, label, box, tool, foam, wiping action, stain-removal action, or unrelated prop unless it is explicitly visible in the references or named in a beat.",
        ];
    }
    if (mode === "subject") {
        return [
            "MODE LOCK: subject-led. No commercial product is required. Preserve the referenced person, animal, or character and build the sheet only from the ordered actions and scene in the plan.",
            locationRule,
            "Never invent packaging, bottles, brands, tools, cleaning actions, purchase gestures, or product hero shots.",
        ];
    }
    if (mode === "scene") {
        return [
            "MODE LOCK: scene-led. Preserve one coherent visual world while allowing the ordered event to progress through related zones; no product is required unless one is explicitly visible or named in the plan.",
            locationRule,
            "Never turn the scene into a packaged-product advertisement and never import objects or actions from another category.",
        ];
    }
    return [
        "MODE LOCK: product-led. Use only the exact product visibly supplied in the references or explicitly named in the plan; preserve its shape, components, colors, material, label placement, scale, and identity.",
        locationRule,
        "Never replace it with another product category or add a second unrelated product, package, brand, tool, person, or action.",
    ];
}

export function buildStoryboardReviewSheetPrompt(plan: CanvasCommerceVideoPlan, variantIndex = 1): string {
    const variantNotes = [
        "Variant direction: balanced chronological rhythm with clear subject identity.",
        "Variant direction: stronger opening camera energy while preserving every referenced entity.",
        "Variant direction: more environmental context and natural action continuity.",
        "Variant direction: sharper detail framing with a coherent final resolving visual.",
    ];
    return [
        "Render ONE image that is ONLY a strict 3-by-4 storyboard reference sheet for the short video described below.",
        "Hard layout contract: exactly 3 columns and exactly 4 rows, exactly 12 equal rectangular cells, thin dividers, no missing cells, no merged cells, no oversized hero cell.",
        "Do not make a 1-column vertical strip, 2-by-2 layout, four-scene ad, poster, banner, infographic, comic page, carousel page, landing-page graphic, or final advertising creative.",
        "Every cell must be a clean full-bleed photographic keyframe. The sheet is only for choosing video shots, not for publishing as an ad.",
        "Absolutely no non-diegetic text or graphics: no numbers, no timecodes, no phase labels, no scene titles, no captions, no CTA copy, no buttons, no badges, no corner tags, no arrows, no UI, no overlay typography.",
        "Do not display any visible ordering marks anywhere: no 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, or 12; no black number boxes; no green label blocks; no corner stickers. Shot order must be understood only from the 3-by-4 reading position.",
        "Leave every panel corner photographic and clean. If a corner would contain a number, badge, or title, remove it and show only the underlying scene.",
        "The only readable text allowed is text physically printed on the real product package or label. Never render any words from this prompt into the image.",
        "SOURCE-OF-TRUTH LOCK: the supplied reference images, visual identity, and ordered beat descriptions are authoritative. Generic instructions are lower priority. Never import a person, product, package, prop, brand, garment, scene, or action from another task or category.",
        `Content category: ${plan.productCategory || "referenced visual subject"}.`,
        `Storyboard style: ${plan.storyboardStyle || (resolveStoryboardMode(plan) === "product" ? "direct-response" : resolveStoryboardMode(plan) === "apparel" ? "lifestyle-montage" : resolveStoryboardMode(plan) === "subject" ? "cinematic-subject" : "scene-progression")}.`,
        `Location strategy: ${resolveLocationStrategy(plan)}.`,
        plan.directorBrief ? `BINDING USER DIRECTOR BRIEF: ${plan.directorBrief}. Preserve every explicitly named location, its order, duration, identity lock, and forbidden addition; never narrow this brief to the reference background.` : "",
        plan.plannedLocations?.length ? `MANDATORY LOCATION ORDER: ${plan.plannedLocations.join(" -> ")}. Every one of these locations must be clearly recognizable in the sheet, with no substitution or omission.` : "",
        plan.visualIdentity ? `VISUAL IDENTITY LOCK: ${plan.visualIdentity}.` : "",
        plan.forbiddenAdditions?.length ? `FORBIDDEN ADDITIONS: ${plan.forbiddenAdditions.join(", ")}.` : "",
        ...storyboardModeRules(plan),
        plan.hookDescription ? `Visual hook strategy, internal only: ${plan.hookDescription}. Convert it into image action, not text.` : "",
        plan.enhancementWords ? `Shared style and quality: ${plan.enhancementWords}.` : "",
        variantNotes[(Math.max(1, variantIndex) - 1) % variantNotes.length],
        "Internal shot-order plan only, never draw these notes as text:",
        ...storyboardReviewFrames(plan).map((line) => `- ${line}`),
        "Rules:",
        "- Preserve the same referenced identities, wardrobe, product structure when present, colors, materials, and anatomy across all panels. Preserve visual-world and lighting continuity while allowing the related location changes explicitly planned in the beats.",
        "- Show twelve visibly different but chronologically connected moments. Variation must come from action progression, shot size, camera movement, depth, and planned related locations; it must never come from inventing new entities.",
        "- Follow the exact ordered beats from top-left to bottom-right. Start with the first beat, progress through the middle beats, and end with the final beat. Never reorder phases to fit a generic advertising template.",
        "- Use at least four visibly different shot sizes or compositions and at least three camera heights, directions, or movements across the sheet. No two adjacent panels may be near-duplicates.",
        "- When locationStrategy is related-location-montage, use all distinct related scene descriptions present in the beats and connect them with clean editorial cuts. Do not collapse the whole sheet back into the first reference location.",
        "- Use a high-retention opening only when it is supported by the first beat. Do not automatically add surprise reactions, spills, stains, mess, rescue products, spraying, wiping, foam, before/after comparisons, packaging, or packshots.",
        "- If no standalone product is visible in the references or named in the plan, no standalone product may appear in any panel.",
        "- If a product is present, keep only that exact product and show it only in beats that call for it. If apparel is present, the worn garment itself is the product.",
        "- Do not change a person's face, age group, body proportions, hairstyle, outfit design, or coverage between panels. Do not duplicate, merge, or replace the subject.",
        "- The last two panels must advance or resolve the final assigned beat; they do not need a package, hand-held product, label shot, purchase gesture, or packshot unless the plan explicitly requires one.",
        "- If the source plan mentions slogans, buying prompts, discounts, titles, subtitles, timings, or phase names, translate them into visual action only and never show them as text.",
        "- Keep all claims visually conservative and realistic. Do not invent certifications, prices, discounts, medical effects, user reviews, or impossible before/after results.",
        "- Final check before output: the result must be one vertical 3-by-4 grid with 12 photo cells, zero overlay text, and zero visible numbering. If there is any ambiguity, simplify the content but keep the 12-cell grid.",
    ]
        .filter(Boolean)
        .join("\n");
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
            subject?: string;
            action?: string;
            scene?: string;
            lighting?: string;
            camera?: string;
            style?: string;
            quality?: string;
            constraint?: string;
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
    if (plan.storyboardMode) lines.push(`分镜模式：${plan.storyboardMode}`);
    if (plan.storyboardStyle) lines.push(`分镜风格：${plan.storyboardStyle}`);
    if (plan.locationStrategy) lines.push(`场景策略：${plan.locationStrategy}`);
    if (plan.plannedLocations?.length) lines.push(`地点顺序：${plan.plannedLocations.join(" → ")}`);
    if (plan.directorBrief) lines.push(`导演要求：${plan.directorBrief}`);
    if (plan.visualIdentity) lines.push(`视觉身份：${plan.visualIdentity}`);
    if (plan.selectedHookType) lines.push(`钩子类型：${plan.selectedHookType}`);
    if (plan.hookDescription) lines.push(`钩子描述：${plan.hookDescription}`);
    if (plan.audioPlan) {
        lines.push(`声音方式：${plan.audioPlan.mode || "mixed"}`);
        if (plan.audioPlan.language) lines.push(`口播语言：${plan.audioPlan.language}`);
        if (plan.audioPlan.voice) lines.push(`声线：${plan.audioPlan.voice}`);
        if (plan.audioPlan.script) lines.push(`整片口播：${plan.audioPlan.script}`);
    }
    lines.push("");
    if (plan.beats?.length) {
        for (const beat of plan.beats) {
            const phaseLabel: Record<string, string> = { hook: "Hook", pain: "Pain", demo: "Demo", cta: "CTA" };
            lines.push(`## Beat ${beat.index} | ${phaseLabel[beat.phase] || beat.phase} | ${beat.timeRange}`);
            if (beat.shotType) lines.push(`景别：${beat.shotType}`);
            if (beat.cameraMove) lines.push(`运镜：${beat.cameraMove}`);
            lines.push(`描述：${beat.description}`);
            if (beat.spokenLine) lines.push(`台词：${beat.spokenLine}`);
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
    const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
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
    const promptText =
        userPrompt.trim() ||
        (template === "videoprompt"
            ? "请根据参考图片写一段短版英文视频生成提示词：运镜开头，只保留最关键的动作、证明镜头和收尾，不要提及宫格或参考图。"
            : mode === "video" || template === "storyboard"
              ? "请结合参考图片生成与素材类型匹配的短视频分镜规划，后续用于12宫格候选图。不得新增参考图中不存在的商品、人物或道具；人物/服饰题材可规划与素材语义一致的相关地点蒙太奇。"
              : "请结合参考图片整理产品视觉要素。");
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
                              {
                                  type: "text" as const,
                                  text:
                                      template === "videoprompt"
                                          ? `用户需求：${promptText}\n\n参考图片数量：${images.length}。只输出短版英文视频提示词正文；在内部读取素材，但不要在结果中提 reference、storyboard、grid 或 panel，也不要要求用户补充信息。`
                                          : template === "storyboard"
                                            ? `绑定导演要求（最高优先级，禁止缩写、改写或降级）：${promptText}\n\n参考图片数量：${images.length}。参考图用于锁定人物、服装、商品和可见实体；导演要求用于确定时长、地点、地点顺序、动作与禁用项。若导演要求点名多个地点，plannedLocations 和 beats 必须逐一覆盖所有地点，不得退回首张参考图的单一背景。请严格结合参考图片完成当前模板，不要要求用户补充信息。`
                                            : `用户需求：${promptText}\n\n参考图片数量：${images.length}。请严格结合参考图片完成当前模板，不要要求用户补充信息。`,
                              },
                              ...images,
                          ]
                        : promptText,
                },
            ],
            stream: false,
            max_tokens: template === "videoprompt" ? 600 : 2000,
            temperature: template === "videoprompt" ? 0.2 : 0.3,
        },
        { headers: aiHeaders(requestConfig) },
    );
    const content = readPayloadContent(response.data, "润色失败");
    return template === "videoprompt" ? normalizeGeneratedVideoPrompt(content) : content;
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
