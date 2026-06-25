---
name: shared-commerce
description: 电商带货视频的通用知识库——钩子类型、品类策略、合规约束、画面八要素、强化词模板。所有视频相关 skill 共用此基础知识。
---

# 电商带货通用知识

本文件是所有视频相关 skill（视频分镜、视频生成）的共享知识库。不是独立触发的 skill，而是被其他 skill 引用的基础规则。

---

## 核心原则

带货视频的目的是卖货，不是拍电影。每一个画面都必须服务于"让观众掏钱"这个目标。

带货视频结构是 **Hook → Pain → Demo → CTA**，不是影视叙事的"全景→中景→特写→拉远"。

| 时段 | 作用 | 正确做法 | 错误做法 |
|------|------|---------|---------|
| 0-3s | 留人 | 视觉冲击/反差钩子 | 全景交代环境 |
| 3-6s | 扎心 | 痛点场景，让观众觉得"这说的就是我" | 主体慢慢出现 |
| 6-12s | 证明 | 产品演示/效果对比/使用过程 | 唯美空镜 |
| 12-15s | 收割 | CTA：价格锚点/限时/行动指令 | 拉远收尾 |

---

## 七种钩子类型

前 3 秒决定视频生死。钩子 = 反差、夸张、变异、奇招，不是开箱或慢热介绍。

| 编号 | 类型 | 定义 | 适用品类 | 示例 |
|------|------|------|---------|------|
| 1 | 反差 | 预期 vs 现实的巨大落差 | 清洁/美妆/工具 | 油污灶台→一擦锃亮 |
| 2 | 痛点直击 | 直接展示用户最痛的场景 | 健康/家居/母婴 | 半夜起夜5次的中年男人 |
| 3 | 夸张视觉 | 放大产品效果到极端 | 食品/玩具/3C | 巨型芒果切开汁水喷射 |
| 4 | 反常识 | 打破用户认知 | 教育/工具/食品 | "这个东西居然能吃？" |
| 5 | 悬念 | 制造好奇心缺口 | 通用 | "老公看到这个脸都绿了" |
| 6 | 数字冲击 | 用数据制造震撼 | 保健/金融/效率 | "3天卖了50万瓶" |
| 7 | Before-After | 使用前后强烈对比 | 美妆/清洁/健身 | 左半脸素颜 vs 右半脸上妆 |

### 使用规则
- 根据产品品类自动推荐 2-3 种最合适的钩子
- 生成多组分镜让客户选择
- 客户不满意时，排除已试过的钩子类型，从剩余类型中重选
- 钩子时长 2-3 秒，不能超过 3 秒

---

## 品类策略

不同品类的带货逻辑差别很大。

| 品类 | 推荐钩子 | 核心镜头 | 节奏 | 合规红线 |
|------|---------|---------|------|---------|
| 保健/医疗 | 痛点直击、数字冲击 | 成分特写、服用场景、Before-After | 中速、权威感 | 必须标注"非医疗建议"，禁止承诺治愈 |
| 清洁/家居 | 反差、Before-After | 污渍特写→清洁过程→洁净效果 | 快节奏、满足感 | — |
| 美妆/护肤 | Before-After、夸张视觉 | 质地特写、上脸过程、光泽对比 | 中速、质感优先 | 禁止承诺医疗效果 |
| 食品/饮品 | 夸张视觉、反常识 | 食材特写、制作过程、食用瞬间 | 快切、食欲感 | 需标注过敏原（如适用） |
| 3C/工具 | 反差、数字冲击 | 开箱、功能演示、效率对比 | 快节奏、科技感 | — |
| 运动/户外 | 夸张视觉、Before-After | 运动场景、产品细节、汗水力量感 | 快节奏、能量感 | — |
| 母婴 | 痛点直击、悬念 | 使用场景、宝宝反应、安全细节 | 温和、信任感 | 必须强调安全认证 |

---

## 画面八要素

每个 beat（每 3-4 秒一个节奏点）必须包含以下八个要素。缺一个，AI 视频模型就按默认值填充，输出"平均水准"。

1. **主体** — 谁/什么在画面里（具体到年龄、穿着、状态）
2. **动作** — 具体到"发丝晃动""手指按压胶囊"，不能写"在使用产品"
3. **场景** — 具体地点、空间布局、环境细节
4. **光影** — 自然光/人工光/时间点/光线方向/色温
5. **镜头语言** — 景别（全/中/近/特写）+ 运镜（跟拍/推/拉/固定/环绕）
6. **风格** — 调性关键词（产品宣传片/生活纪实/高级感/科技感）
7. **画质** — 4K、电影感、胶片颗粒、浅景深等
8. **约束** — 产品外观一致、人物不变形、动作连贯、禁止文字

### 铁律：禁止抽象词
- 不能写"效果好" → 要写"特写手指按压胶囊，胶囊在掌心缓缓溶解，金色粉末散开"
- 不能写"感人" → 要写"母亲在床边轻轻抚摸孩子额头，眼泪在眼眶里打转"
- 不能写"高品质" → 要写"微距镜头下可见金属拉丝纹理和精密车削痕迹"
- 全局禁止词：beautiful / amazing / epic / stunning / gorgeous / incredible / breathtaking

---

## 强化词模板

每段视频 prompt 尾部必须追加强化词。

### 画质稳定类（必加）
4K ultra HD, cinematic quality, natural body proportions, smooth continuous motion, no frame skipping, consistent appearance throughout

### 光影类（按场景选）
- 室内暖光：warm golden hour lighting, soft shadows, ambient indoor glow
- 室外自然光：natural sunlight, soft diffused daylight, subtle lens flare
- 夜间冷光：cool blue moonlight, street lamp warm accent, high contrast
- 产品棚拍：clean studio lighting, soft gradient background, rim light separation

### 氛围类（按品类选）
- 保健品：calm authoritative, medical-grade cleanliness, trust-building composition
- 清洁用品：satisfying transformation, visible before-after contrast, clean minimal
- 食品：appetite-inducing, juicy texture detail, steam and freshness cues
- 3C数码：sleek tech aesthetic, precision engineering feel, cool-tone minimalism
- 运动：high energy, dynamic motion, sweat and power

### 负面约束（必加）
Negative prompt: no distorted hands, no duplicated subjects, no sudden scene jumps, no visible storyboard labels, no arrows, no grid panels, no watermarks, no text overlays unless explicitly requested

---

## 合规层

### MUST（必须做）
- 保健品/医疗品必须在画面或字幕中标注"非医疗建议"
- 母婴产品必须强调安全认证
- 食品标注过敏原（如适用）
- Before-After 对比必须标注"效果因人而异"

### NEVER（绝对不能做）
- 承诺治愈任何疾病
- 使用医生/护士形象暗示医疗背书（除非是真实合作）
- 编造数据或伪造用户评价
- 使用虚假限时、虚假库存紧张
- 对食品/保健品做夸大功效宣传

### SHOULD（建议做）
- CTA 用真实价格，不用"仅需xxx"这种话术
- 演示效果用真实产品，不用替代品
- 人物多样性：不要只用一种肤色/体型/年龄
