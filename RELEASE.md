# Infinite Canvas v3.0.99

This release assigns each canvas customer a dedicated upstream New API Key so task and usage records are attributed to the customer instead of `root`.

- New canvas accounts receive their dedicated upstream Key immediately after registration.
- Existing canvas accounts keep their current `vc_live_` Key and receive a dedicated upstream Key on login or their first request.
- Dedicated upstream Keys are encrypted in the canvas auth database and are used for synchronous requests and asynchronous video polling.
- If the private provisioning bridge is temporarily unavailable, the previous upstream Key remains as a compatibility fallback so existing generation is not interrupted.
- The previous production image `ghcr.io/tzx666888/infinite-canvas:v3.0.98` and the pre-release image `infinite-canvas:v3.0.97` remain rollback targets.

Rollback: preserve the pre-release backup under `/opt/infinite-canvas/data/deploy-backups/infinite-canvas-v3.0.97-pre-customer-key-*`, set Compose image back to `infinite-canvas:v3.0.97`, and redeploy with Docker Compose. Do not use `git reset --hard`, `git clean`, or delete data volumes.

Production image: `ghcr.io/tzx666888/infinite-canvas:v3.0.99`.

Previous release details are retained in Git history and the `v3.0.98` and `v3.0.97` tags.
