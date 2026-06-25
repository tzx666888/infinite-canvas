---
name: video-prompt
description: 视频生成提示词编写——根据视频分镜规划和目标视频模型（Grok/Veo），编写可直接用于视频生成的英文提示词。客户选择"视频生成"时触发此 skill。
---

# 视频生成提示词 Skill

## 触发条件
客户在画布上完成视频分镜后，选择「🎥 视频生成」模版，或者直接请 Agent 根据分镜写视频提示词。

## 前置知识
本 skill 依赖 shared-commerce 的通用知识（钩子、品类、八要素、强化词）。

---

## 支持的视频模型

线上只有两个视频模型，不要引入其他的：

| 模型 | 特点 | prompt 风格 |
|------|------|------------|
| Grok | 简洁连续，单段叙事 | 100-180 词英文单段，用逗号和 then 连接 |
| Veo | 结构化，支持时间轴 | 可分段，用时间轴标记 [0:00-0:03] |

## 支持的时长
4 / 8 / 12 / 15 秒。不能写死 15 秒。

## 参考模式
- **t2v**（文生视频）：纯文字描述，不提参考图
- **i2v**（图生视频）：追加参考图保真约束
- **r2v**（参考视频生视频）：追加参考视频运动节奏约束

---

## Grok 提示词编写规则

### 格式
单段连续英文描述，100-180 词。不分段，不加时间轴标记。

### 结构
```
[比例和构图指引], [hook 动作描述], then [pain 场景], then [demo 产品演示], then [CTA 收尾]. [强化词]. Negative prompt: [约束].
```

### 示例（前列腺胶囊，15s，9:16 竖屏）
```
A vertical 9:16 cinematic commerce video. Open on a dark bedroom at 3:47 AM, alarm clock glowing blue, a tired 50-year-old man pushing himself up from bed with swollen eyes and messy hair, cold street light seeping through curtain gap casting harsh shadows on his face, then he shuffles down a dimly lit hallway toward the bathroom dragging his feet on cold tiles, then cut to a warm-lit close-up of his palm holding two golden capsules, he swallows them with water, camera pushes in as he settles back into bed and his expression softens into calm sleep, then morning sunlight floods the bedroom, he wakes energized and stretches with a genuine smile, product box appears bottom-right with a subtle price tag overlay. 4K ultra HD, cinematic quality, warm-to-cool color transition, natural body proportions, smooth continuous motion, consistent appearance. Negative prompt: no fake medical claims, no distorted hands, no text overlays except price tag, no sudden jumps.
```

### 关键约束
- 每个 beat 的八要素都要覆盖到（主体、动作、场景、光影、镜头、风格、画质、约束）
- 禁止抽象词，所有描述必须是具体的视觉动作
- 产品必须在 demo 和 cta 阶段清晰可见
- 用 then 连接动作，保持一条叙事主线
- 控制在 180 词以内，Grok 超长 prompt 会丢失细节

---

## Veo 提示词编写规则

### 格式
结构化分段描述，每段带时间轴标记。

### 结构
```
Create a [时长]-second [比例] commerce video.
[0:00-0:03] [景别], [运镜]: [hook 描述].
[0:03-0:07] [景别], [运镜]: [pain 描述].
[0:07-0:11] [景别], [运镜]: [demo 描述].
[0:11-0:15] [景别], [运镜]: [CTA 描述].
[一致性约束].
[参考图约束（如适用）].
[强化词].
Negative prompt: [约束].
```

### 示例（前列腺胶囊，15s，9:16 竖屏，i2v 模式）
```
Create a 15-second vertical 9:16 commerce video for a prostate health supplement.
[0:00-0:03] close-up, static: Dark bedroom at 3:47 AM, alarm clock glowing blue, a tired 50-year-old man with swollen under-eyes and messy grey hair pushes himself up from rumpled white sheets, cold blue-white street light cuts through curtain gap onto his deeply lined face.
[0:03-0:07] medium shot, follow: The man shuffles barefoot down a dim hallway lit only by a faint amber nightlight at ankle level, his hunched shoulders and dragging steps convey exhaustion, camera follows at waist height.
[0:07-0:12] close-up, push-in: Warm kitchen light, his weathered palm holds two glossy golden capsules, he takes them with a glass of water, camera pushes in as he returns to bed and his tense expression gradually softens into peaceful sleep.
[0:12-0:15] medium shot, static: Morning golden sunlight floods the bedroom, the man wakes with energy, stretches with a genuine smile, product box composited bottom-right with clean price overlay.
Maintain consistent subject appearance, product shape, and scene lighting logic across all shots.
Maintain visual continuity with the reference image: preserve subject appearance, color palette, and composition.
4K ultra HD, cinematic quality, warm-to-cool color transition, natural body proportions, smooth motion.
Negative prompt: no fabricated medical certifications, no fake endorsements, no distorted anatomy, no visible storyboard labels, no grid panels, no watermarks.
```

### 关键约束
- 时间轴标记按实际时长均分，不要硬套 0-3/3-7/7-11/11-15
- 每段必须指定景别和运镜
- i2v 模式必须追加参考图保真约束
- r2v 模式必须追加参考视频运动约束
- Veo 允许更长的描述，但每段不超过 50 词

---

## 时长适配规则

| 时长 | 保留的 beat | 说明 |
|------|-----------|------|
| 4s | hook + cta | 只有视觉冲击和产品露出，极简 |
| 8s | hook + pain + cta | 加痛点但跳过演示 |
| 12s | hook + pain + demo + cta | 完整结构但每段压缩 |
| 15s | 全部 beat（5-7个） | 完整节奏，可以有转场和备选 |

短视频（4s/8s）要把最核心的信息前置，不要试图塞完整故事。

---

## 参考图约束

### i2v（图生视频）
追加到 prompt 末尾：
```
Maintain visual continuity with the reference image: preserve subject appearance, color palette, and composition.
```

### r2v（参考视频生视频）
追加到 prompt 末尾：
```
Use the reference video as motion and rhythm guidance. Preserve the subject and key visual elements from the reference frames.
```

### 关键：排除审阅分镜图
如果上游连线里有标记为 `storyboardRole: "review-sheet"` 的节点（带编号、箭头、中文说明的分镜拼图），绝对不能作为参考图传给视频模型。只使用标记为 `storyboardRole: "keyframe"` 的干净关键帧。

---

## 输出要求
- 提示词必须是英文（视频模型只接受英文）
- 给客户的说明可以用中文
- 用 `canvas_update_node_text` 将视频提示词回填到节点
- 如果客户没有指定模型，默认按 Grok 格式输出（更通用）
- 同时提供 Grok 和 Veo 两个版本让客户选择更好
