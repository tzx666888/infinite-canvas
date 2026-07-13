---
name: video-storyboard
description: 根据文字与参考图规划 6/10/15 秒商业视频，输出 CommerceVideoPlan、固定 3×4 审阅图方向和干净关键帧任务。
---

# 视频分镜

## 输入
读取：
- 当前文字与所有有效参考图标签。
- 当前目标时长 6、10 或 15 秒。
- 当前比例 9:16、16:9 或 1:1。
- 产品拆解、场景扩展或客户明确提供的数据。

参考图信息按 visual_observed、user_supplied、verified_product_data、unknown 分层，unknown 不编造。

## 规划结构
先判断：
- 商品展示：reveal → interaction → detail → hero。
- 生活方式：establish → interaction → detail → finish。
- 教程：setup → action → proof → finish。
- 明确带货：Hook → Pain → Demo → CTA。

时长与 beat：
- 6 秒：2-3 个 beat。
- 10 秒：3-4 个 beat。
- 15 秒：4-6 个 beat。

beat 必须按时间顺序覆盖完整时长，不重叠、不留空。每个 beat 只描述一个可执行动作和一个连贯场景。

## CommerceVideoPlan
JSON 的 productCategory、selectedHookType、hookDescription、beat description、eightElements、compliance、enhancementWords 使用英文。JSON 后附中文分镜说明。

每个 beat 包含：
- index、phase、timeRange。
- shotType、cameraMove。
- description。
- eightElements：subject、action、scene、lighting、camera、style、quality、constraint。

只输出可观察或客户明确提供的内容。不得编造问题、结果、价格、认证、评价或医疗效果。

## 审阅图
画布固定生成 3 列 × 4 行、12 个等大摄影格：
- 零编号、零时间码、零标题、零箭头、零 CTA、零 UI、零水印。
- 12 格按 beat 时间顺序分配，展示动作开始、延续、细节、转场和不同机位。
- 每格身份、服装、产品现实尺度、颜色、材质、logo 和标签位置一致。
- 审阅图只用于选择方向，不能直接传给视频模型。

## 干净关键帧
客户选定审阅图后，每个 beat 生成一张独立全屏关键帧：
- 只读取对应 beat 的格子作为构图方向。
- 原始产品/人物参考图仍是身份权威。
- 无网格、边框、编号、文字或水印。
- 每张只表示该 beat 的一个清楚瞬间。

## 安全
遵守 shared-commerce。人物为自然成年人；泳装或贴身服装使用非色情时尚编辑语境。禁止虚假前后对比、医学结果、折扣、认证、评价和无法验证的产品效果。
