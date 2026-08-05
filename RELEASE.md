# Infinite Canvas v3.0.57

Canvas Agent now exposes a guided commerce-video options card on top of the existing video generation pipeline.

- Defaults to hands-free / Philippines / Omni portrait / 720x1280.
- Creator mode accepts a second creator image and preserves creator-before-product reference order.
- Omni, Veo and Seedance remain the only card choices; Seedance is labelled as silent and awaits channel-level live verification.
- M1 prompt length targets are warnings unless the prompt exceeds 2400 characters.
- Fifteen-second creator shots use duration, transition and ASMR labels in that order.
- Google static image generation remains 4K-only from v3.0.56.

Rollback source is tag `v3.0.56`: check it out, rebuild the v3.0.56 image manually, then run `docker-compose down` followed by `docker-compose up -d`. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.57`.
