# Infinite Canvas v3.0.69

This release restores the image-generation prompt behavior used by v3.0.53 while retaining the reliability improvements added since that release.

- Requests such as `生成一组不同场景电商详情图` no longer receive a forced per-result scene or standalone-layout compiler.
- The selected result count still creates the same number of independent single-image requests, allowing each output to form a complete, information-rich commerce board naturally.
- Background job recovery, successful-result writeback, download retries, concurrency controls and model parameter isolation remain unchanged.
- Video models, video prompts, routing and billing are unchanged.

Rollback source is tag `v3.0.68`: check it out, rebuild the v3.0.68 image, then redeploy with Docker Compose. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.69`.
