---
name: shared-commerce
description: 商业图片与视频的通用真实性、身份一致性、尺度、安全、合规和镜头质量规则。
---

# 商业视觉通用规则

## 先判断真实意图
先区分商品展示、生活方式、教程演示、镜头复刻和明确带货。只有客户明确要带货时才采用 Hook → Pain → Demo → CTA；不得给普通展示视频强加事故、痛点、尖叫或夸张反应。

## 信息分层
- visual_observed：参考图可直接确认。
- user_supplied：客户明确给出。
- verified_product_data：客户提供且可核验。
- unknown：未知，禁止编造。

## 身份与尺度
- 参考图是人物、产品、角色和服装身份权威。
- 保持五官、年龄段、发型、服装、轮廓、现实尺寸类别、比例、颜色、材质、部件数量与位置、logo 和标签位置。
- 只保留清楚可见的原文字；模糊文字保持版式，不猜测字符。
- 用手、身体、桌面、家具、门、地面或环境作为尺度锚点，不缩小、放大、拉伸、复制、融合或重新设计产品。

## 镜头八要素
每个图片任务或视频 beat 应具体描述：
1. 主体
2. 动作
3. 场景
4. 光线
5. 构图或运镜
6. 风格
7. 当前模型可实现的原生质量
8. 身份、物理、安全和负面约束

不要用空泛词代替可见细节。不要用 4K、8K 冒充模型不支持的原生输出。

## 带货钩子
可用 contrast、pain-point、visual-shock、counter-intuitive、curiosity、number-impact、before-after，但必须有真实信息支持。product-reveal、tutorial、lifestyle 适合非强推销内容。
钩子来自构图、动作、尺度或真实视觉差异，不来自虚构数据、疾病、伤害、污渍、认证、评价、折扣或结果。

## 合规
禁止：
- 治愈、康复、减肥、永久变美等无法支持的承诺。
- 编造成分、认证、价格、折扣、库存、销量、医生或专家背书、用户评价。
- 未经支持的 Before/After 和“效果因人而异”式补丁；没有依据时根本不生成对比。
- 自动把免责声明、价格或 CTA 画进图片。只有客户明确提供并要求时才处理文字，而且不得与“无文字”约束冲突。

高风险品类只展示可观察的产品外观与使用过程。需要法律或平台文案时创建独立文本，不让生图模型臆造。

## 人物安全
- 人物必须具有自然骨骼、面部、手指和合理接触关系。
- 泳装、内衣或贴身服装只使用明确成年人的非色情商业时尚语境，姿势自然、服装不透明，不突出私密部位，不用窥视、恋物或年龄模糊镜头。
- 不能把不同参考图中的人物、产品或身体部位融合。

## 通用负面约束
no identity drift, no distorted anatomy, no extra fingers or limbs, no duplicated subject, no product-person hybrid, no warped or resized product, no floating object, no invented label, no false claim, no watermark。
