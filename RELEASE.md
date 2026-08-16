# Infinite Canvas v3.0.97

This release adds the Indonesia TikTok Shop / MiniMax H3 creative-director skill to both the website Agent and the local canvas Agent.

- Installs `.agents/skills/indonesia-tiktok-h3-director` with Product Truth Sheet, Hook scoring, Indonesian voiceover, H3 prompt contract, and final audio/video QC.
- Website Agent exposes the skill as capability 16; local Agent exposes it as skill 7.
- The workflow keeps the existing generation-confirmation gate: prompt planning is read-only, `canvas_prepare_video` requires explicit confirmation, and video generation is never auto-submitted.
- Product claims, price/discount/stock/social-proof assertions, and unverified before/after claims remain blocked.
- Sources were screened for portability and license; official MiniMax H3, MIT Hook/UGC and MIT media-QC principles were used, while paid-runtime and restrictive-license packages were not installed.

Acceptance target: source diff review, skill validation, production build, container health, website Agent read-only prompt test, local Agent skill discovery, and no video-generation charge during the test.

Rollback: restore the pre-release backup under `/opt/infinite-canvas/data/deploy-backups/infinite-canvas-v3.0.96-pre-indonesia-tiktok-*`, set Compose image back to `infinite-canvas:v3.0.96`, and redeploy with Docker Compose. Do not use `git reset --hard`, `git clean`, or delete data volumes.

Production image: `infinite-canvas:v3.0.97`.
