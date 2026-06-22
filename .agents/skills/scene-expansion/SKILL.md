---
name: scene-expansion
description: 电商产品场景扩展——读取产品参考图，锁定产品身份，规划并生成多张独立场景图（每张一个场景，禁止拼图）。客户选择"场景扩展"时触发此 skill。
---

# 场景扩展 Skill

## 触发条件
客户在画布上选中产品图片节点，点击润色菜单里的「🖼️ 场景扩展」，再点 Agent 执行。

## 完整工作流

### 第一步：读取画布状态
调用 `canvas_get_state` 或 `canvas_get_selection`，找到客户选中的图片节点。

### 第二步：分析产品，规划场景
根据参考图锁定产品身份，按客户指定数量（默认 10）规划独立场景。

#### 产品身份锁定规则
- 参考图是唯一权威来源，必须保留产品轮廓/比例/颜色/材质/部件数量与位置/logo/标签/可见文字
- 不得重新设计产品

#### 场景规划规则
- 每个场景是一次独立生图任务：一个地点、一个时刻、一个机位、一张完整照片
- 严禁拼图/九宫格/分屏/联系表/分镜板/多面板/前后对比/信息图
- 各场景在环境/用途/构图/光线上要有肉眼可见的差异
- 每张图以一个主产品为视觉中心（多件套装除外）
- 根据品类决定人物出镜：操作型只露手和手腕，穿戴型展示必要身体部位，不需要人物时纯产品场景

#### 输出格式
```json
{
  "productName": "中文产品名称",
  "identity": "Complete English identity lock...",
  "scenes": [
    {
      "title": "场景中文名称",
      "focus": "该场景的唯一用途和画面重点",
      "prompt": "English prompt for exactly one standalone commercial lifestyle product photograph..."
    }
  ]
}
```

### 第三步：在画布创建节点并生图
1. 用 `canvas_create_text_node` 创建场景规划文本节点
2. 对每个 scene，用 `canvas_generate_image` 创建生图流程：
   - prompt 由以下部分组成：
     - "Create exactly one NEW standalone commercial lifestyle product photograph. The supplied images are identity references only, not a canvas to copy."
     - "PRODUCT IDENTITY LOCK: {identity}"
     - "SINGLE SCENE: {scene.prompt}"
     - "PRIMARY PURPOSE: {scene.focus}"
     - "Render one coherent location, one moment, one camera viewpoint, and one full-frame photograph."
     - 产品身份保持规则
     - 禁止拼图/九宫格/grid/split screen/contact sheet 等
     - 禁止在同一张图中混合多个场景/时间/角度
     - 自然场景构图：物理一致的比例/透视/接触阴影/反射/景深
   - referenceNodeIds 指向源图节点
   - model 用 gpt-image-2

### 第四步：并发控制
最多同时生成 2 张图。

## 关键区别：场景扩展 vs 产品拆解
- 产品拆解 = 棚拍细节图，中性背景，聚焦产品结构
- 场景扩展 = 生活场景图，真实环境，聚焦产品使用场景
- 两者都要锁定产品身份，但场景扩展多了环境、光线、人物互动的要求

## 禁止事项
- 禁止空泛词（beautiful/amazing/epic/stunning/gorgeous/incredible）
- 禁止在一张图里放多个场景
- 禁止重新设计产品外观
- title 和 focus 用中文，identity 和 prompt 用英文
