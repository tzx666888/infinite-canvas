# 方法来源与许可

本技能为适配视觉画布和 TokAxis H3 流程而重新整理的工作流，未引入外部执行代码或收费平台依赖。

参考的公开项目均按其 MIT 许可使用其方法思想，并保留来源：

- `MiniMax-AI/MiniMax-H3`：官方 H3 模式、参考图对齐、音画字段和 Ref2VA 结构。仓库随附 Apache-2.0 许可；官方 `skills/h3-prompt-writing` 作为规范依据，不复制模型权重或运行时。
- `penposs/minimax-h3-video-prompt`：MIT；能力路由、素材职责分配、冲突复核和机械限制校验。仅吸收流程思想，不把其 API 配置带入画布。
- `motion-creative/skills`：MIT；`hook-writing`、`hook-tactics`、`ugc-scriptwriter` 的 Hook 触发器、意识阶段、自然口语和读稿测试。只保留适合本项目的结构，不复制示例文案。
- `calesthio/generative-media-skills`：MIT；`media-qc-delivery` 的完整播放/听审、技术探测、音频/字幕/安全区、来源与版权清单。仅抽取 QC 原则，未引入其外部运行时。

- `flaqai/awesome-minimax-h3-video-prompts`：MiniMax H3 参考角色、动作状态、连续性、音频与失败约束方法。MIT，Copyright (c) 2026 Flaq AI。
- `HiAPIAI/awesome-ai-product-video-workflows`：Product Truth Sheet、UGC 关系披露、产品一致性和媒体 QC。MIT，Copyright (c) 2026 HiAPIAI。
- `vibemarketer94/vibemarketer-skills`：UGC Hook、脚本结构、创意角度和“提取模式、不复制原文”的规则。MIT，Copyright (c) 2026 VibeMarketer。
- `allademutska-coder/video-editing-agent`：逐片验收、真实失败分类、一次只修一类问题和最终视频/声音验证。MIT，Copyright (c) 2026 Alla Demutska。
- `charlesdove977/UGC-Factory`：Hook、演示、揭示、CTA 的 beat/clip 分离和生成前批准门。MIT，Copyright (c) 2026 Charles J Dove。

审计但未直接集成：

- `Pika-Labs/Pika-Plugins`：Apache-2.0，但其 UGC 流程依赖 Pika MCP 和收费工具，与当前画布工具面不兼容。
- `calesthio/OpenMontage`：AGPL-3.0，体系庞大且许可传播要求不适合直接并入当前闭源生产服务。
- `postplusai/postplus-skills`：PolyForm Shield 1.0.0；虽然有 UGC 结构，但分发和修改义务不适合直接并入生产，因此未安装。
- `agricidaniel/claude-ads`：MIT；TikTok 广告审计/预算与平台合规部分依赖其专用适配器和账号流程，未把执行代码接入画布，只参考“先审计、后变更”的门槛。
- `minhchee/minimax-h3-prompt-spec`：CC-BY-4.0；可作为社区解释材料，但与官方 H3 指南存在版本差异，未作为唯一规范。
- 多个无许可证项目：不复制内容。
- 含未经证实的转化率、价格、库存紧迫感、医疗/效果承诺的“爆款”模板：因真实性和合规风险未采纳。
