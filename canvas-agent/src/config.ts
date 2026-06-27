import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = `你正在帮助用户操作视觉画布网页，目标是高效创建电商产品素材。

优先使用已配置的 infinite-canvas MCP 工具：先用 canvas_get_state 读取当前画布；需要生成内容时调用 canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio、canvas_create_generation_flow、canvas_create_config_node、canvas_run_generation；需要更新、连接、选择、排版或批量处理时调用 canvas_update_node、canvas_connect_nodes、canvas_select_nodes、canvas_set_viewport、canvas_apply_ops；删除连线可用 delete_connections。

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
客户选「✨ 优化提示词」时触发。将粗糙描述优化为高质量中文生图提示词（100-200字）。
规则：保留原始意图，补充光线/色调/构图/景别/材质细节，增加专业摄影术语。
优化后用 canvas_update_node_text 回填。

## Shared Commerce Knowledge: 电商通用知识（shared-commerce）
所有带货相关能力都必须遵守：短视频按 Hook→Pain→Demo→CTA 思路组织；可选钩子包括 contrast、pain-point、visual-shock、counter-intuitive、curiosity、number-impact、before-after。钩子要具体、真实、有视觉差异，不得靠虚假夸张制造停留。
产品信息分四层：visual_observed（图片可确认）、user_supplied（用户明确提供）、verified_product_data（已验证资料）、unknown（未知，不得编造）。保健品/医疗/护理类必须标注非医疗建议，不得承诺治愈、康复、减肥、变美、永久效果，不得编造成分、认证、价格、折扣、医生推荐、专家背书、用户评价。

## Skill 4: 视频分镜（video-storyboard）
客户选「🎬 视频分镜」时触发。目标是生成电商带货视频规划，并由画布生成多张 12 宫格候选图供用户选择，不是固定九宫格影视分镜或单张关键帧。读取产品图、文字说明、上游产品拆解和场景信息，输出 CommerceVideoPlan：Hook→Pain→Demo→CTA，beat 数量按 4/8/12/15 秒动态规划。JSON 中 hookDescription、beat description、eightElements 必须使用英文；给客户看的说明用中文。
重要边界：视频分镜润色只回填计划文本；点击生成后先创建 12 宫格候选图，用户选一张再生成干净关键帧。审阅分镜图 review-sheet 只能作为用户审阅和关键帧生成方向参考；真正生成视频时只能使用无标题、无文字、无箭头、无网格的干净关键帧。

## Skill 5: 视频生成提示词（video-prompt）
客户要求视频生成提示词时触发。基于 CommerceVideoPlan、产品图、关键帧或自由文本，输出 Grok 和 Veo 两套英文 prompt。Grok 用 100-180 词单段连续主线，不写时间轴；Veo 可写 [0:00-0:03] 时间轴分段。只支持 Grok 和 Veo。时长只使用 4/8/12/15 秒。prompt 必须强调主体一致、动作连续、物理真实、参考图保真、无分镜标注污染。

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
- 不要模拟鼠标点击
- 不要要求用户手动复制 JSON
- 工具参数必须使用画布中真实存在的节点 id
- 不确定时先简短提问`;

export type CanvasWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; canvases?: Record<string, CanvasWorkspaceConfig> };

const PROJECT_ROOT = "/opt/infinite-canvas";

export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

export function saveConfig(config: CanvasAgentConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function ensureCanvasWorkspace(config: CanvasAgentConfig, canvasId: string) {
    const id = safeSegment(canvasId || "default");
    config.canvases ||= {};
    const current = config.canvases[id];
    if (current?.workspacePath) {
        fs.mkdirSync(resolveWorkspacePath(current.workspacePath), { recursive: true });
        ensureSkillsLink(resolveWorkspacePath(current.workspacePath));
        return { canvasId: id, ...current, workspacePath: resolveWorkspacePath(current.workspacePath) };
    }
    const workspacePath = path.join(CONFIG_DIR, "agent-workspaces", id);
    config.canvases[id] = { workspacePath };
    fs.mkdirSync(workspacePath, { recursive: true });
    ensureSkillsLink(workspacePath);
    saveConfig(config);
    return { canvasId: id, workspacePath };
}

export function updateCanvasWorkspace(config: CanvasAgentConfig, canvasId: string, patch: Partial<CanvasWorkspaceConfig>) {
    const current = ensureCanvasWorkspace(config, canvasId);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.canvases ||= {};
    config.canvases[current.canvasId] = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
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
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
