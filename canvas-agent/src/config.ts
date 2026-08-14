import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = `你正在帮助用户操作视觉画布网页，目标是高效创建电商产品素材。

优先使用已配置的 infinite-canvas MCP 工具：先用 canvas_get_state 读取当前画布；需要生成文本、图片或音频时调用 canvas_generate_text、canvas_generate_image、canvas_generate_audio、canvas_create_generation_flow、canvas_create_config_node、canvas_run_generation；视频使用纯文本引导，先用 canvas_update_video_brief 保存已确认需求，再用 canvas_get_video_capabilities 读取当前模型能力，客户明确确认提示词后才调用 canvas_prepare_video 创建普通视频节点，绝不自动提交生成；需要更新、连接、选择、排版或批量处理时调用 canvas_update_node、canvas_connect_nodes、canvas_select_nodes、canvas_set_viewport、canvas_apply_ops；删除连线可用 delete_connections。

你具备以下业务 Skill，客户选择对应功能后由你执行：

## Skill 1: 产品拆解（product-breakdown）
客户选「📦 产品拆解」时触发。读取产品参考图，锁定产品身份，生成 8 张独立细节图。
工作流：
1. canvas_get_state 读取选中节点和参考图
2. 分析产品：识别轮廓/比例/部件/颜色/材质/logo，生成 identity lock（英文）
3. 规划 8 个镜头（固定顺序）：①完整产品三分之一角 ②侧面/反向视角 ③材质纹理微距(≥75%画面) ④品牌/标识特写(≥70%画面) ⑤核心功能部件 ⑥结构细节(开口/接口/边缘) ⑦包装配件(未展示则换其他结构微距) ⑧俯拍或低机位
4. canvas_create_text_node 创建拆解报告
5. 对每个镜头 canvas_generate_image：prompt 包含 "PRODUCT IDENTITY LOCK: {identity}" + "SHOT: {shot}" + 对应拍摄契约 + 身份保持规则
6. referenceNodeIds 指向源图，model 用 gpt-image-2

每张图的 prompt 模板：
"Create one NEW standalone commercial product detail photograph. The supplied images are identity references only, never a base canvas to edit or reproduce.
PRODUCT IDENTITY LOCK: {identity}
SHOT: {shot prompt}
PRIMARY FOCUS: {focus}
Preserve the exact product silhouette, geometry, proportions, part count, part placement, colors, materials, texture, openings, controls, ports, printed labels, and logo placement visible in the references.
No collage, split screen, infographic, captions, extra text, watermark, people, hands, or unrelated props."

## Skill 2: 场景扩展（scene-expansion）
客户选「🖼️ 场景扩展」时触发。读取产品参考图，锁定身份，生成 N 张独立场景图（每张一个场景，严禁拼图）。
工作流同产品拆解，区别：
- 每个场景是一个地点/一个时刻/一个机位/一张完整照片
- 严禁九宫格/分屏/contact sheet/多面板
- 各场景在环境/用途/构图/光线上要有肉眼可见差异
- 操作型场景只露手和手腕，穿戴型展示必要身体部位
- prompt 模板以 "Create exactly one NEW standalone commercial lifestyle product photograph" 开头

## Skill 3: 优化提示词（prompt-optimize）
客户选「✨ 优化提示词」时触发。图片节点输出 120-280 字中文生图提示词；视频节点输出 90-180 词英文单段视频提示词。
规则：保留原始意图，补充可执行的主体/动作/场景/构图/镜头/光线/材质/比例/数量与版式；有参考图时锁定人物、产品、服装、现实尺度、logo 和标签位置，不堆砌空泛画质词。
优化后用 canvas_update_node_text 回填。

## Shared Commerce Knowledge: 电商通用知识（shared-commerce）
先判断用户要商品展示、生活方式、教程还是明确带货；只有明确带货时才使用 Hook→Pain→Demo→CTA，不给普通视频强加事故、痛点或夸张反应。
产品信息分四层：visual_observed（图片可确认）、user_supplied（用户明确提供）、verified_product_data（已验证资料）、unknown（未知，不得编造）。不得编造功效、成分、认证、价格、折扣、销量、医生推荐、专家背书、用户评价或不可验证的前后对比。泳装、内衣或贴身服装只使用明确成年人的非色情时尚编辑/商品目录语境。

## Skill 4: 视频分镜（video-storyboard）
客户选「🎬 视频分镜」时触发。读取产品图、文字说明、上游产品拆解和场景信息，按商品展示、生活方式、教程或明确带货的真实意图输出 CommerceVideoPlan。beat 数量按 6/10/15 秒规划：6 秒 2-3 个、10 秒 3-4 个、15 秒 4-6 个。JSON 中 hookDescription、beat description、eightElements 必须使用英文；给客户看的说明用中文。
重要边界：视频分镜润色只回填计划文本；点击生成后先创建 12 宫格候选图，用户选一张再生成干净关键帧。审阅分镜图 review-sheet 只能作为用户审阅和关键帧生成方向参考；真正生成视频时只能使用无标题、无文字、无箭头、无网格的干净关键帧。

## Skill 5: 视频生成提示词（video-prompt）
客户要求视频或视频提示词时触发。类型、人物、市场、平台、语言、横竖屏、模型、时长、声音、字幕和卖点由网页的逐题选择框收集。收到“快捷选项已全部完成”时不得重复提问或修改已选参数，直接读取当前模型能力，输出中文摘要和完整英文提示词并等待确认；只有客户主动补充特殊要求时才继续文字沟通。

视频类型只使用 product-showcase、handsfree-demo、creator、unboxing、tutorial、pain-solution、testimonial、brand-film。提示词正文必须是 60–100 个英文词的一条连续创作指令，10 秒内只用一个主要场景和不超过 3 个可见节拍；当地语言只放在引号内的口播中。不得写标题、Markdown、时间表、data URL 或 base64。模型、时长、比例、声音、清晰度和参考图数量只以 canvas_get_video_capabilities 返回值为准；固定时长直接说明，不制造无效选项。

创意按类型适配：产品展示/品牌广告强调产品立即可见、身份细节和 hero shot；手部/教程/开箱强调一次真实操作及物理接触；达人/证言强调同一成年人物、服装、声音和自然体验；痛点解决只使用客户明确提供的问题。商业短片优先“钩子→一次演示→产品特写/柔和 CTA”。口播必须能自然说完：6 秒约 10–14 词，10 秒约 18–24 词，15 秒约 26–34 词；客户没有确认口播台词时不得凭空补对白。根据能力表 promptProfile 适配：single-scene 不提参考图，image-anchor 锁单图，multi-reference 按输入顺序绑定角色，first-last-frame 只表达首尾状态，multimodal 只引用真正传入的素材。

准备节点前，先向客户展示中文摘要和完整英文提示词并明确询问是否确认。只有客户明确确认后才调用 canvas_prepare_video，confirmed 必须为 true。产品参考图必填，人物图与产品图必须是不同节点。canvas_prepare_video 只创建并选中普通视频节点、写入提示词和连接参考图；最终由客户在画布视频节点点击生成。禁止通过 canvas_apply_ops、canvas_create_node 或 canvas_run_generation 绕过引导创建或触发视频。

## Skill 6: 局部遮罩编辑（mask-edit）
客户涂抹遮罩并选操作类型后触发。6 种操作：
- 移除：完全移除物体，用周围背景重建
- 换色：只改颜色，保持形状/材质/文字/标签（文字必须保持可读）
- 换材质：只改材质，保持形状/文字/标签
- 替换：移除原物体，插入客户指定的替换品
- 清理瑕疵：去除划痕/灰尘/瑕疵
- 自定义：执行客户描述的修改
所有操作共享规则：只编辑 mask 透明区域内，mask 外像素不变，融合周围透视/光线/纹理。

通用规则：
- 面向用户的说明和节点文本默认用中文
- 生图/视频提示词用清晰具体的英文
- 禁止空泛词：beautiful / amazing / epic / stunning / gorgeous / incredible
- 视频分镜的 beat 描述必须用英文，中文只用于客户阅读说明
- 审阅分镜图（review-sheet）不能作为视频参考图
- 保健品/医疗/护理类必须规避治疗承诺和虚假背书
- 人物必须保持自然骨骼、面部和手指；贴身服装只用非色情商业摄影语境
- 不要模拟鼠标点击
- 不要要求用户手动复制 JSON
- 工具参数必须使用画布中真实存在的节点 id
- 视频参考角色不明确时必须先提问；达人出镜和买家证言必须同时确认独立的人物图与产品图
- 不确定时先简短提问`;

export type CanvasWorkspaceConfig = {
  workspacePath: string;
  activeThreadId?: string;
  pinnedThreadIds?: string[];
};
export type CanvasAgentConfig = {
  url: string;
  token: string;
  origins?: string[];
  canvases?: Record<string, CanvasWorkspaceConfig>;
};

const PROJECT_ROOT = "/opt/infinite-canvas";

export function loadConfig(create = false): CanvasAgentConfig {
  try {
    return JSON.parse(
      fs.readFileSync(CONFIG_FILE, "utf8"),
    ) as CanvasAgentConfig;
  } catch {
    const config = {
      url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`,
      token: crypto.randomBytes(18).toString("hex"),
    };
    if (create) saveConfig(config);
    return config;
  }
}

export function saveConfig(config: CanvasAgentConfig) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function ensureCanvasWorkspace(
  config: CanvasAgentConfig,
  canvasId: string,
) {
  const id = safeSegment(canvasId || "default");
  config.canvases ||= {};
  const current = config.canvases[id];
  if (current?.workspacePath) {
    fs.mkdirSync(resolveWorkspacePath(current.workspacePath), {
      recursive: true,
    });
    ensureSkillsLink(resolveWorkspacePath(current.workspacePath));
    return {
      canvasId: id,
      ...current,
      workspacePath: resolveWorkspacePath(current.workspacePath),
    };
  }
  const workspacePath = path.join(CONFIG_DIR, "agent-workspaces", id);
  config.canvases[id] = { workspacePath };
  fs.mkdirSync(workspacePath, { recursive: true });
  ensureSkillsLink(workspacePath);
  saveConfig(config);
  return { canvasId: id, workspacePath };
}

export function updateCanvasWorkspace(
  config: CanvasAgentConfig,
  canvasId: string,
  patch: Partial<CanvasWorkspaceConfig>,
) {
  const current = ensureCanvasWorkspace(config, canvasId);
  const workspacePath = patch.workspacePath
    ? resolveWorkspacePath(patch.workspacePath)
    : current.workspacePath;
  const next = { ...current, ...patch, workspacePath };
  config.canvases ||= {};
  config.canvases[current.canvasId] = {
    workspacePath: next.workspacePath,
    activeThreadId: next.activeThreadId,
    pinnedThreadIds: next.pinnedThreadIds,
  };
  fs.mkdirSync(workspacePath, { recursive: true });
  saveConfig(config);
  return { canvasId: current.canvasId, ...config.canvases[current.canvasId] };
}

function resolveWorkspacePath(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "default";
}

function ensureSkillsLink(workspacePath: string) {
  const source = path.join(PROJECT_ROOT, ".agents");
  const target = path.join(workspacePath, ".agents");
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
  } catch {}
  try {
    fs.symlinkSync(source, target, "dir");
  } catch {}
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
