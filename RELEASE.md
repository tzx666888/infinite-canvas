# Infinite Canvas v3.0.59

This release keeps customer-facing generation failures business-safe and aligns the canvas video controls with the capabilities that are currently usable upstream.

- Canvas nodes no longer expose provider service names, project IDs, media paths or raw upstream payloads.
- Veo multi-reference remains fixed at 8 seconds but now sends the available 720p route instead of an unavailable 1080p variant.
- All Seedance entries submit only 5, 10 or 15 seconds and reject reference images above the provider's 12MB limit before a paid request.
- Regression coverage verifies the public error presentation and the real Veo/Seedance capability contracts.

Rollback source is tag `v3.0.58`: check it out, rebuild the v3.0.58 image manually, then run `docker-compose down` followed by `docker-compose up -d`. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.59`.
