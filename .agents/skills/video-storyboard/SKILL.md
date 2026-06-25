---
name: video-storyboard
description: 电商带货视频分镜生成——根据产品图和品类，按 Hook→Pain→Demo→CTA 结构生成视频分镜规划和关键帧提示词。客户选择"视频分镜"时触发此 skill。
---

# 视频分镜 Skill

## 触发条件
客户在画布上选中产品图片节点，点击润色菜单里的「🎬 视频分镜」，再点 Agent 执行。

## 前置知识
本 skill 依赖 shared-commerce 的通用知识（钩子类型、品类策略、合规约束、八要素、强化词）。使用前必须读取 shared-commerce skill。

---

## 完整工作流

### 第一步：读取输入
- 读取客户选中的产品图片（1-3 张）
- 读取客户写的文字说明（产品名、卖点、目标人群等）
- 读取节点的视频配置：时长（4/8/12/15s）、目标比例（9:16/16:9/1:1）

### 第二步：分析产品，确定品类和钩子

#### 产品分析四层信息
1. **visual_observed** — 从产品图直接看到的（颜色、形状、材质、文字、logo）
2. **user_supplied** — 客户文字说明里提到的（卖点、价格、目标人群）
3. **verified_product_data** — 可以确认的产品数据（品类、基本功能）
4. **unknown** — 看不到也没说的信息，标记为 unknown，不编造

#### 确定品类
根据产品分析结果，匹配品类策略表（见 shared-commerce）。如果不确定品类，用通用策略。

#### 选择钩子
根据品类推荐 2-3 种钩子类型，选一种作为主钩子。如果客户之前试过某种钩子不满意（metadata.excludedHookTypes），排除已试过的。

### 第三步：生成 CommerceVideoPlan

输出结构化 JSON 规划。**所有 description 和 eightElements 字段必须用英文**，视频模型只接受英文。

```json
{
  "productCategory": "health-supplement",
  "selectedHookType": "pain-point",
  "hookDescription": "Exhausted middle-aged man waking up for the 5th time at night to use the bathroom",
  "beats": [
    {
      "index": 0,
      "phase": "hook",
      "timeRange": "0-3s",
      "shotType": "close-up",
      "cameraMove": "static",
      "description": "Dark bedroom at 3:47 AM, alarm clock glowing blue, tired 50-year-old man pushing himself up from bed with swollen eyes",
      "eightElements": {
        "subject": "50-year-old man, puffy under-eyes, messy grey hair, wrinkled sleep shirt",
        "action": "pushes himself up from rumpled white sheets with both arms, face heavy with exhaustion",
        "scene": "dark bedroom, white sheets, wooden nightstand with empty supplement bottles",
        "lighting": "cold blue-white street light through curtain gap, harsh shadows on face",
        "camera": "side close-up from nightstand level, static",
        "style": "documentary realism, not staged",
        "quality": "4K, shallow depth of field, film grain",
        "constraint": "face clearly visible, expression natural not exaggerated"
      }
    },
    {
      "index": 1,
      "phase": "pain",
      "timeRange": "3-6s",
      "shotType": "medium",
      "cameraMove": "follow",
      "description": "Man shuffles down dim hallway toward bathroom, hunched shoulders, dragging feet on cold tiles"
    },
    {
      "index": 2,
      "phase": "demo",
      "timeRange": "6-12s",
      "shotType": "close-up",
      "cameraMove": "push-in",
      "description": "Warm kitchen light, weathered palm holds two golden capsules, takes them with water, returns to bed, expression softens into peaceful sleep"
    },
    {
      "index": 3,
      "phase": "cta",
      "timeRange": "12-15s",
      "shotType": "medium",
      "cameraMove": "static",
      "description": "Morning golden sunlight floods bedroom, man wakes energized, stretches with genuine smile, product box composited bottom-right with price overlay"
    }
  ],
  "compliance": {
    "mustInclude": ["non-medical-advice disclaimer"],
    "mustNotInclude": ["cure promises", "doctor imagery"],
    "riskLevel": "medium"
  },
  "enhancementWords": "4K ultra HD, cinematic quality, warm-to-cool color transition, natural body proportions, smooth motion, consistent appearance"
}
```

### 第四步：动态面板数量

根据视频时长决定面板数量，不固定 12 个：

| 时长 | 视觉 beat 数 | 面板总数 | 网格 |
|------|-------------|---------|------|
| 4s | 2-3 | 4-6 | 2×3 |
| 8s | 3-4 | 6-8 | 2×4 |
| 12s | 4-6 | 8-10 | 3×4 |
| 15s | 5-7 | 10-12 | 3×4 |

面板数 > beat 数是因为包含备选方案和转场细节。

### 第五步：双输出

一次分镜操作生成两类内容：

#### A. 审阅分镜图（review-sheet）
- 一张带网格的拼图
- 每格有编号、时间段标注、中文镜头说明、运镜箭头
- 用途：给客户审阅确认节奏和构图
- 节点 metadata 标记 `storyboardRole: "review-sheet"`
- **绝对不能作为视频模型的参考输入**

#### B. 干净关键帧（keyframes）
- 一组独立的纯画面图片，无编号、无箭头、无网格、无文字
- 每张对应一个 beat
- 用途：作为视频生成的参考图（i2v/r2v）
- 节点 metadata 标记 `storyboardRole: "keyframe"`、`storyboardBeatIndex: N`

### 第六步：回填结果

用 `canvas_update_node_text` 将 CommerceVideoPlan JSON 和中文分镜说明回填到节点。客户确认后，由"生成"按钮触发实际生图（不是润色菜单触发）。

---

## 关键区别：新版 vs 旧版

| | 旧版 | 新版 |
|--|------|------|
| 结构 | 固定 3×3 九宫格 | 动态面板，按时长调整 |
| 逻辑 | 影视叙事节奏 | Hook→Pain→Demo→CTA 带货节奏 |
| 钩子 | 无 | 7 种钩子类型，按品类推荐 |
| 品类感知 | 无 | 根据产品自动匹配品类策略 |
| 合规 | 无 | 保健品/母婴/食品合规约束 |
| 输出 | 中文提示词 | 结构化 JSON + 英文 beat 描述 |
| 信息密度 | 低（一句话描述一格） | 高（八要素全覆盖） |
| 视频模型适配 | 无 | beat 可被编译为 Grok/Veo 格式 |
| 双输出 | 无 | 审阅分镜图 + 干净关键帧 |

---

## 禁止事项
- 禁止用影视叙事结构（全景→中景→特写→拉远）替代带货结构
- 禁止钩子超过 3 秒
- 禁止 beat 描述用中文（视频模型不接受）
- 禁止 beat 描述用抽象词（见 shared-commerce 禁止词列表）
- 禁止编造产品图中看不到的功能或效果
- 禁止审阅分镜图被用作视频生成参考
