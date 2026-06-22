---
name: product-breakdown
description: 电商产品拆解摄影——读取产品参考图，锁定产品身份，规划并生成 8 张独立细节镜头图。客户选择"产品拆解"时触发此 skill。
---

# 产品拆解 Skill

## 触发条件
客户在画布上选中产品图片节点，点击润色菜单里的「📦 产品拆解」，再点 Agent 执行。

## 完整工作流

### 第一步：读取画布状态
调用 `canvas_get_state` 或 `canvas_get_selection`，找到客户选中的图片节点，获取其 id、图片 URL 和尺寸。

### 第二步：分析产品，规划 8 个镜头
根据参考图（最多 3 张），精准识别产品身份，输出结构化拆解方案。

#### 产品身份锁定规则
- 参考图是产品身份的唯一权威来源
- 精准识别：轮廓、比例、部件数量与位置、颜色、材质、纹理、接口、按钮、开孔、标签、logo、包装配件
- 不得把同一产品误拆成多个产品
- 不得改变结构、颜色、logo、文字、配件数量或部件位置
- 看不清或没有展示的包装、配件和隐藏结构不得编造

#### 8 个镜头规划（固定顺序）
每个镜头是独立的单张产品图，不做拼图/九宫格/文字说明页。

| 编号 | 镜头类型 | 必须满足的拍摄契约 |
|------|----------|-------------------|
| 1 | 完整产品新构图 | 全产品三分之一角度，占画面 65-80%，干净中性背景 |
| 2 | 侧面/反向三分之一视角 | 展示不同可见面，新机位高度，新中性背景 |
| 3 | 材质纹理微距 | 目标纹理占画面 ≥75%，不展示完整产品 |
| 4 | 品牌/标识/最具识别度细节 | 细节占画面 ≥70%，不返回全产品视图 |
| 5 | 核心功能部件特写 | 只拍部件及其与主体的连接处，展示结构和材质过渡 |
| 6 | 结构细节（开口/接口/边缘/关节） | 斜角微距，不沿用原图构图 |
| 7 | 包装/配件（参考图未展示时改为另一处可见结构微距） | 仅在参考图明确可见时拍包装，否则换成其他结构细节 |
| 8 | 俯拍或低机位完整产品 | 与镜头 1 差异最大的角度，新朝向/裁切/灯光/背景 |

#### 输出格式
```json
{
  "productName": "中文产品名称",
  "category": "产品品类",
  "identity": "Complete English identity lock: shape, proportions, colors, materials, key components and positions",
  "materials": ["中文材质"],
  "components": ["中文可见部件"],
  "visibleMarks": ["中文可见标识"],
  "packageAccessories": ["中文包装配件"],
  "shots": [
    {
      "title": "镜头中文名称",
      "focus": "本张图的唯一重点",
      "prompt": "English prompt for one standalone commercial product detail photograph..."
    }
  ]
}
```

### 第三步：在画布上创建节点并生图
1. 用 `canvas_create_text_node` 创建拆解报告文本节点，连接到源图节点
2. 对每个 shot，用 `canvas_generate_image` 创建生图流程：
   - prompt 由以下部分组成：
     - "Create one NEW standalone commercial product detail photograph. The supplied images are identity references only, never a base canvas to edit or reproduce."
     - "PRODUCT IDENTITY LOCK: {identity}"
     - "SHOT: {shot.prompt}"
     - "PRIMARY FOCUS: {shot.focus}"
     - "MANDATORY CAMERA AND FRAMING CONTRACT: {对应编号的拍摄契约}"
     - 产品身份保持规则（轮廓/几何/比例/部件数/颜色/材质/logo 等）
     - 禁止返回源图/近似复制/源裁切/源角度/源背景
     - 禁止拼图/分屏/信息图/水印/人物/无关道具
   - referenceNodeIds 指向源图节点
   - model 用 gpt-image-2
3. 节点排列：报告在源图右侧，8 张图在报告右侧，2 列 4 行

### 第四步：并发控制
最多同时生成 2 张图，避免 API 限流。

## 禁止事项
- 禁止使用 beautiful / amazing / epic / stunning / gorgeous / incredible 等空泛词
- 禁止 8 张图使用相同机位或构图
- 禁止编造参考图中未展示的结构
- 禁止合成拼图或九宫格
- title 和 focus 用中文，identity 和 prompt 用英文
