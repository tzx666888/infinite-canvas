# Infinite Canvas v3.0.72

This release combines the generation-panel hover fix with the already deployed MiniMax H3 reference-media bridge.

- Hover detection is now limited to the visible node body and its connection handles.
- Prompt textareas, model controls, settings popovers and generate buttons no longer trigger the floating node toolbar.
- Moving back to the image, video or text node still restores the toolbar normally.
- Browser-local H3 image and audio references are exposed through random, 24-hour temporary HTTPS URLs instead of incompatible data URIs.
- The H3 bridge is isolated from every other video model and preserves established model parameters.
- Generation prompts, billing, task recovery and stored canvas data are unchanged.

Acceptance covers image/video hover interaction, temporary-media contract regression, TypeScript and production build.

Rollback source is tag `v3.0.70`: check it out, rebuild the v3.0.70 image, then redeploy with Docker Compose. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.72`.
