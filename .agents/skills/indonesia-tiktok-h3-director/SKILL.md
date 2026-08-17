---
name: indonesia-tiktok-h3-director
description: 为印度尼西亚 TikTok Shop 规划、编写和质检 MiniMax H3 商品带货短视频。用于用户要求印尼爆款带货视频、15 秒 H3 提示词、Bahasa Indonesia 口播、UGC 达人广告、产品展示、开箱、教程、痛点解决、竞品爆款拆解、Hook 变体或视频生成后验收时；从画布选中商品图和已验证资料出发，输出真实可执行的创意角度、分镜、英文 H3 prompt、印尼语口播和质检结论。
---

# 印尼 TikTok H3 爆款导演

把“爆款”定义为可测试的创意假设，不承诺流量。优先提高前 2 秒停留、产品识别、演示可信度、印尼语自然度和 H3 可执行性。

## 先读取

- 始终遵守 `shared-commerce` 和 `video-prompt`。
- 写 H3 prompt 时读取 [h3-prompt-contract.md](references/h3-prompt-contract.md)。
- 写 Hook、口播和 UGC 结构时读取 [ugc-indonesia-playbook.md](references/ugc-indonesia-playbook.md)。
- 验收成片或决定是否重跑时读取 [qc-scorecard.md](references/qc-scorecard.md)。
- 需要说明方法来源或复用范围时读取 [sources-and-license.md](references/sources-and-license.md)。

## 输入事实

先读取当前选中节点和上游节点，建立简短 Product Truth Sheet：

- `visual_observed`：图片中能直接确认的外观、颜色、材质、结构、标签位置。
- `user_supplied`：用户明确提供的品名、卖点、价格、优惠、用途。
- `verified_product_data`：有可追溯来源的成分、规格、认证和结果。
- `unknown`：未知，禁止写入卖点、口播或画面。

产品图必填。达人出镜时，人物图与产品图必须为两个独立节点。必须额外提取品类、完整品名、SKU/规格/颜色/口味/数量、包装结构、logo/标签位置和逐字包装文字；看不清的文字标为 `[包装文字不可辨]`，不得猜测。若出现多个 SKU、文字模糊、资料矛盾、语言变体不明或核心卖点没有证据，先明确提问并暂停脚本/生成。没有真实证据时，不得使用评价、销量、稀缺库存、折扣、治疗效果或前后对比。

在继续前先输出：

```text
Product Truth Sheet
- 品类 / 品牌 / 完整品名：
- SKU（规格 / 颜色 / 口味 / 数量）：
- 可见包装锚点（形状、材质、主色、闭合件、logo/标签位置）：
- 包装原文（逐字）：
- 可验证卖点与证据来源：
- unknown / 不得补全字段：
- 需用户确认的问题：
```

## 创意工作流

### 1. 判断视频类型

从当前画布支持的八种类型中选择：product-showcase、handsfree-demo、creator、unboxing、tutorial、pain-solution、testimonial、brand-film。

- 明确带货且有人物图：优先 `creator`。
- 只有产品图：优先 `product-showcase` 或可真实执行的 `handsfree-demo`。
- `testimonial` 只能写成合成达人演示，禁止伪装成真实买家经历。
- `pain-solution` 只使用用户明确提供且合规的问题。

### 2. 生成并筛选 3 个 Hook

每个 Hook 必须同时包含：首帧画面、第一句口播或声音动作、产品出现时刻、可见证明。

优先从以下模式选择，并根据商品变化，不复制竞品原句：

- curiosity demo：直接展示一次具体动作，让观众等结果。
- objection flip：先说真实顾虑，再用可见演示回答。
- routine fit：把产品放入印尼用户熟悉的日常场景。
- product-first reveal：首帧即看见产品和关键细节。
- comment reply：只在用户提供真实评论时使用。

按 100 分筛选：停滑力 25、产品清晰度 15、可见证明 20、印尼语自然度 15、H3 可执行性 15、合规 10。低于 75 分重写；选择最高分方案，同时保留另外两条作为 A/B 提示词变体。

### 3. 规划 15 秒结构

默认一位成年人物、一个产品、一个主要地点和一条连续动作链：

- 0–3 秒：Hook，产品立即可见或在 1 秒内进入画面；首帧就给动作、冲突或可观察结果。
- 3–10 秒：一次真实演示或体验，最多两个连续动作，只展示可验证证据。
- 10–15 秒：产品细节 → 稳定 hero shot → 柔和 CTA；只保留一个 CTA。

如果当前模型能力或用户时长不同，按能力表重新压缩；10 秒内不超过 3 个可见节拍。不要在 15 秒内塞入多地点、多人物或多条卖点。

### 4. 写印尼语口播

- 使用自然、简短、易说的 Bahasa Indonesia；默认中性口语，不堆砌网络俚语。
- 15 秒通常控制在 26–34 个词，并逐句朗读检查。
- 只讲一个核心卖点；优先可见动作和具体使用场景。
- CTA 使用自然表达，例如 `Cek produknya di keranjang`、`Lihat detailnya di TikTok Shop`；购物车颜色或位置只有平台当前界面和用户明确要求支持时才写。
- 禁止翻译腔、过度夸张、虚假第一人称体验和无法证实的紧迫感。
- 必须分开输出 `Bahasa 口播` 与 `Bahasa 字幕`：口播是演员实际说的完整句子，字幕是更短、更易读的屏幕文本；品牌名、SKU、数字和包装原文保持一致。字幕优先后期叠加，不让 H3 现场生成包装字或字幕。

### 5. 写 H3 提示词

先调用 `canvas_get_video_capabilities`，模型、时长、比例、声音和参考模式以返回值为准。然后按以下顺序写英文单段 prompt：

1. 交付物、市场、平台、比例与时长。
2. 参考图角色映射及优先级。
3. 开始状态 → 一条主要动作链 → 结束状态。
4. 人物、产品、环境和镜头各自的运动。
5. 产品身份、人物身份、接触、尺度、文字和声音约束。
6. 开启声音时，只写一条 `Spoken script: "..."`，内容与已确认印尼语口播逐字一致。
7. 可观察的失败约束：identity drift、extra fingers、hand-product fusion、changing geometry、mirrored labels、gibberish text、duplicate product、watermark。

最终完整 prompt 保持 90–170 个英文词，直接复制给 H3；在单段 prompt 内保留明确的 `0.0–3.0s HOOK`、`3.0–10.0s EVIDENCE`、`10.0–15.0s CONVERSION` 时间边界，不使用模糊的“开头/中间/结尾”。必须预留字幕安全区，并把精确字幕留给后期叠加。不得写 data URL、base64、未上传素材或模型不支持的参数。

英文 prompt 至少包含：产品参考为唯一身份来源；精确包装轮廓、颜色、logo、标签、数量与比例锁；三段时间边界；一条原样 Bahasa Indonesia `Spoken script`；以及 `changing product geometry`、`mirrored labels`、`gibberish text`、`duplicate product`、`watermark` 等可观察失败约束。

### 6. 确认与执行边界

先向用户展示：Product Truth Sheet、需确认问题、获胜 Hook、中文创意摘要、15 秒结构、完整英文 H3 prompt、Bahasa 口播、Bahasa 字幕和两条 A/B Hook 变体。

用户明确确认后才调用 `canvas_prepare_video`，并传 `confirmed=true`。只创建和连接普通视频节点，不自动提交生成、不自动扣费。不得通过其他画布工具绕过该确认流程。

## 竞品或爆款参考

用户提供 TikTok、Reels、视频文件或转写时，只提取：开场画面、Hook 类型、产品出现时间、动作链、节奏、证明方式、CTA 风格和可能有效的原因。

不得复制原句、人物身份、笑点、独特镜头顺序、音乐、品牌视觉或完整脚本。把参考模式转换为当前产品的新创意，并明确列出 `借鉴的结构` 与 `禁止复制的元素`。

## 成片验收

任务状态为成功不等于成片合格。必须观看完整视频并听完整音频，按 `qc-scorecard.md` 打分，并逐项记录产品一致性、文字清晰度、Bahasa 口播自然度、违禁/高风险功效词、首帧吸引力和三段式 CTA 是否完成。

- 任一硬失败：产品身份明显漂移、声音为噪音/不完整、口播错语言、视频不可解码、时长/比例错误、虚假声明、明显畸形或乱码主导画面，直接判重跑。
- 80 分及以上且无硬失败：通过。
- 65–79：只修改最主要的一类失败，再重跑。
- 低于 65：回到 Hook、动作链或参考图选择重做，不继续在同一 prompt 上堆词。

每次只修一类失败，记录原因、修改内容、耗时和结果；重跑建议必须给出可直接复制的英文 prompt，并保留已确认的产品锁。产品变形/包装错字优先改参考图与正面 packshot；口播不自然改短句和停顿；功效词改为可观察描述；文字问题改为干净底片+后期叠字；首帧弱只重写 0–3 秒 Hook。

## 默认输出

1. Product Truth Sheet
2. 3 个 Hook 与评分
3. 获胜创意摘要
4. 0–3 / 3–10 / 10–15 秒镜头结构
5. Bahasa 口播与 Bahasa 字幕（分开）
6. 可直接用于当前 H3 能力的英文 prompt
7. 两条 A/B Hook 变体
8. 生成后质检表与定向重跑 prompt
