---
name: mask-edit
description: 局部遮罩编辑——对图片选区执行移除/换色/换材质/替换/清理瑕疵/自定义 6 种操作。客户涂抹遮罩并选择操作类型后，点 Agent 执行触发此 skill。
---

# 局部遮罩编辑 Skill

## 触发条件
客户在画布上选中图片，点「局部编辑」，用画笔涂抹要编辑的区域，选择操作类型（移除/换色/换材质/替换/清理瑕疵/自定义），再点 Agent 执行。

## 核心概念

### Mask 语义
- **透明区域** = 可编辑区（用户涂抹的蓝色区域）
- **白色/不透明区域** = 锁定区（不允许改动）

### 裁切选区流程（前端自动处理）
1. 根据 mask 透明区计算包围盒
2. 加 padding（max(32px, 选区尺寸45%, 图片尺寸2.5%)）
3. 只把裁出的局部原图+局部 mask 发给模型
4. 生成结果按完整 mask 合成回原图（羽化半径 3-24px）

### 粗略遮罩扩展（仅移除模式）
用户粗略涂几笔表示"移除这个产品"时，系统自动：
- 按 640px 网格下采样 → BFS 洪泛填充 → 连通区域合并 → 凸包扩展
- 覆盖目标主体、边缘、倒影、接触阴影
- 其他 5 种操作保持精确遮罩，不自动扩展

## 6 种操作的 Prompt 模板

### 通用规则（所有操作共享）
```
Edit only inside the supplied transparent mask.
Everything outside the mask must remain pixel-identical: do not move, resize, crop, redraw, relight, recolor, sharpen, blur, or alter any unmasked object, text, logo, background, composition, or camera perspective.
Blend the edited area naturally with the surrounding perspective, scale, lighting direction, exposure, color temperature, texture, reflections, contact shadows, depth of field, and image grain.
```

### 1. 移除（remove）
```
TASK: OBJECT REMOVAL AND BACKGROUND INPAINTING.
Completely remove the selected object. Do not preserve, redraw, deform, recolor, shrink, crop, relocate, or leave any fragment of it.
Remove all selected text, logos, edges, outlines, color residue, contact shadows, reflections, and visual traces belonging to the removed object.
Reconstruct the empty area from the immediately surrounding real background, continuing the same surface, wall, material texture, pattern, perspective lines, lighting, reflection, depth of field, and grain.
Do not insert a replacement object and do not duplicate any nearby object.
```
- 客户输入：可选补充（如"保留右侧产品，只移除涂抹的包装盒"）
- 显示标签：「移除选区」

### 2. 换色（recolor）
```
TASK: RECOLOR THE SELECTED OBJECT.
Target color: {客户输入的颜色}.
Change only the color of the selected object while preserving its exact silhouette, geometry, proportions, topology, labels, logos, text, material, texture, transparency, highlights, reflections, and shadows.
Every printed character, label, barcode, regulatory mark, serial number, and fine text on the product surface must remain in its original position, font, size, and content. If any text becomes illegible after recoloring, redraw it at the same location with the original font and layout, adjusting only its color for contrast against the new surface color.
Preserve the original rendering style exactly: if the source is a flat illustration keep it flat, if photorealistic keep it photorealistic. Do not add or remove 3D shading, highlights, glossy reflections, or depth effects that were not present in the original.
The result must look like the same physical product photographed in the target color.
```
- 客户输入：**必填**，目标颜色（如"深蓝色""珍珠白""潘通 186 C"）
- 显示标签：「更换颜色」

### 3. 换材质（material）
```
TASK: CHANGE THE MATERIAL OF THE SELECTED OBJECT.
Target material: {客户输入的材质}.
Preserve the selected object's exact silhouette, geometry, dimensions, proportions, topology, labels, logos, text, position, and orientation.
All printed text, labels, logos, barcodes, and regulatory marks must remain fully legible after material change. Adjust text color if needed for contrast against the new material, but preserve original position, font, size, and content.
Change only its surface material response, with physically plausible texture, roughness, highlights, transparency, reflections, and contact shadows.
```
- 客户输入：**必填**，目标材质（如"磨砂金属""透明玻璃""哑光陶瓷"）
- 显示标签：「更换材质」

### 4. 替换（replace）
```
TASK: REPLACE THE SELECTED OBJECT.
Replacement: {客户输入的替换目标}.
Completely remove the original selected object and insert only the requested replacement in the same masked location.
Match the requested replacement to the scene's scale, camera angle, perspective, lighting direction, exposure, color temperature, contact shadow, reflection, focus, and grain.
Do not alter or duplicate any unmasked object.
```
- 客户输入：**必填**，替换成什么（如"白色圆瓶，大小和位置保持一致"）
- 显示标签：「替换选区」

### 5. 清理瑕疵（cleanup）
```
TASK: CLEAN UP LOCAL IMPERFECTIONS.
Remove only the selected dust, scratches, stains, unwanted marks, seams, compression artifacts, or small defects.
Reconstruct the original underlying surface naturally while preserving the object's shape, color, material, texture, labels, logos, text, highlights, reflections, and shadows.
```
- 客户输入：可选补充（如"去掉划痕和灰尘，保留原有纹理"）
- 显示标签：「清理瑕疵」

### 6. 自定义（custom）
```
TASK: APPLY THE USER'S LOCAL EDIT.
Requested edit: {客户输入}.
Perform exactly the requested change inside the mask and preserve all unrelated visual properties.
```
- 客户输入：**必填**，修改要求
- 显示标签：「AI 修改」

## 外层约束 Prompt（包裹所有操作）
```
STRICT MASKED EDIT REQUIREMENTS:
- The transparent area of the supplied mask is the only editable region. Opaque mask pixels are locked.
- Do not regenerate, reinterpret, crop, resize, rotate, relight, recolor, sharpen, blur, or otherwise change any pixel outside the editable region.
- Preserve the exact composition, camera, background, text, logos, people, objects, object geometry, materials, colors, lighting, shadows, and image quality outside the editable region.
- Inside the editable region, perform only the user's requested change.
- Match the surrounding perspective, scale, focus, grain, lighting direction, color temperature, reflections, contact shadows, and edge softness so the edit blends naturally.
- Do not add, remove, replace, recolor, or otherwise alter content beyond the user's explicit request.
- Return only the edited image.
```

## API 调用
局部编辑使用 `/images/edits` 端点（不是 `/images/generations`），需要：
- `image`: 裁切后的源图
- `mask`: 裁切后的 mask（透明=可编辑，白色=锁定）
- `prompt`: 操作类型 prompt + 通用规则 + 外层约束
- `model`: gpt-image-2

## 已知问题与注意事项
- 换色操作可能丢失产品上的小字/标签 → prompt 已加强文字保持规则
- 换色可能改变渲染风格（平面变立体）→ prompt 已加风格保持规则
- 换材质对不透明材质（如金属）也可能遮盖文字 → prompt 已加文字保持规则
- 移除模式的粗略遮罩扩展只在"移除"时触发，其他操作不扩展，避免误改
