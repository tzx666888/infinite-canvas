# Infinite Canvas v3.0.70

This release deploys the tested v3.0.53 image-generation behavior restoration and preserves the server's pending video-model availability update.

- Requests such as `生成一组不同场景电商详情图` no longer receive a forced per-result scene or standalone-layout compiler.
- The selected result count still creates the same number of independent single-image requests, allowing each output to form a complete, information-rich commerce board naturally.
- Background job recovery, successful-result writeback, download retries, concurrency controls and model parameter isolation remain unchanged.
- Three unavailable Seedance entries are removed from canvas defaults and saved selections; MiniMax H3 remains the active newly integrated video model.
- Video prompts, provider routing and billing behavior are unchanged.

Real-image acceptance used the primary image pool only: three independent 1024x1024 results completed without retry, with two rich multi-section commerce boards and one standalone hero composition.

Rollback source is tag `v3.0.68`: check it out, rebuild the v3.0.68 image, then redeploy with Docker Compose. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.70`.
