# Infinite Canvas v3.0.56

Google static image generation is now 4K-only.

- Public settings and model synchronization expose only
  `gemini-3.1-flash-image-4k`.
- Legacy base, 1K and 2K selections are recognized only long enough to migrate
  persisted browser settings and historical canvas nodes to 4K.
- Every Google image request is normalized to the 4K public model ID and
  `image_size=4K`.
- The 14 official aspect ratios and their native 4K dimensions remain
  available.
- The immutable rollback image is `infinite-canvas:v3.0.55`.

Production image: `infinite-canvas:v3.0.56`.
