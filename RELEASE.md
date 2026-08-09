# Infinite Canvas v3.0.71

This release prevents node hover actions from covering image, video and text generation panels.

- Hover detection is now limited to the visible node body and its connection handles.
- Prompt textareas, model controls, settings popovers and generate buttons no longer trigger the floating node toolbar.
- Moving back to the image, video or text node still restores the toolbar normally.
- Generation prompts, model routing, billing, task recovery and stored canvas data are unchanged.

Local interaction acceptance covered both image and video nodes, followed by TypeScript and production-build verification.

Rollback source is tag `v3.0.70`: check it out, rebuild the v3.0.70 image, then redeploy with Docker Compose. Do not restore `.bak` files.

Production image: `infinite-canvas:v3.0.71`.
