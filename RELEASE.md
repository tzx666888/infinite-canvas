# Infinite Canvas v3.0.58

Canvas Agent commerce-video presets now cover six enabled P0 markets, editable compiled prompts, an explicit subtitle switch and config-driven model cards while preserving the existing public video generation pipeline.

- Philippines and Malaysia retain the five byte-identical original Xin Ge corpora.
- Indonesia, Thailand, Vietnam and China use clearly marked derived corpora pending review.
- China uses Douyin / Kuaishou context, Chinese-life scenes and mainland advertising-language checks; Thailand and China use script-aware voice-length validation.
- P1 and P2 markets remain visible but disabled, and the default stays hands-free / Philippines / Omni portrait / 720x1280.
- The default generation button still compiles once and immediately generates. “Preview prompt” compiles without creating a node or paid video task; the reviewed prompt can then be edited and submitted without recompilation.
- Reference-image scope, creator first line, display rule and product-consistency tail are locked. Changing any generation parameter invalidates the reviewed draft.
- The subtitle switch defaults off and compiles exactly one display rule. Subtitle-on transport preserves the requested captions without changing the shared public video prompt path.
- Agent cards are the intersection of configured models and models already integrated with the shared video providers. Omni, Veo auto, Veo R2V and fixed Seedance are exposed; unusable direction siblings and unintegrated IDs are hidden, and qy Seedance remains excluded.
- Google static image generation remains 4K-only from v3.0.56.

Rollback source is tag `v3.0.57`: check it out, rebuild the v3.0.57 image manually, then run `docker-compose down` followed by `docker-compose up -d`. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.58`.
