# Grok Video Contract Surface Research

Date: 2026-06-01

## Purpose

Jun requested a deeper `progrok search` pass across official developer docs, X/community claims, and live API behavior for Grok Imagine video.

This document separates:

- official docs
- model metadata endpoints
- live REST smoke
- X/community claims
- ima2 design consequences

## Official Developer Docs

Sources:

- https://docs.x.ai/developers/models/grok-imagine-video
- https://docs.x.ai/developers/models/grok-imagine-video-1.5-preview
- https://docs.x.ai/developers/model-capabilities/imagine
- https://docs.x.ai/developers/model-capabilities/video/generation
- https://docs.x.ai/developers/model-capabilities/video/reference-to-video
- https://docs.x.ai/developers/rest-api-reference/inference/videos
- https://x.ai/api/imagine

Findings:

- Official REST API reference exposes `/v1/videos/generations`, `/v1/videos/edits`, `/v1/videos/extensions`, and `/v1/videos/{request_id}`.
- Official reference-to-video docs use `POST /v1/videos/generations`.
- Official reference-to-video examples show `model: "grok-imagine-video"`, not `grok-imagine-video-1.5-preview`.
- Official reference-to-video request shape is object-based: `reference_images: [{ "url": "<IMAGE_URL>" }]`.
- Official reference-to-video docs state:
  - prompt is required,
  - max 7 reference images,
  - max duration 10 seconds,
  - reference images cannot be combined with image-to-video or video editing,
  - only one mode can be active per request.
- Official 1.5-preview model page lists model id `grok-imagine-video-1.5-preview`, alias `grok-imagine-video-1.5-2026-05-30`, input modalities `Text, Image`, output `Video`, and 480p/720p output pricing.

## Live Model Metadata

Queried through progrok proxy:

```text
GET /v1/video-generation-models
GET /v1/video-generation-models/grok-imagine-video
GET /v1/video-generation-models/grok-imagine-video-1.5-preview
```

Results:

```json
{
  "id": "grok-imagine-video",
  "input_modalities": ["text", "image"],
  "output_modalities": ["video"]
}
```

```json
{
  "id": "grok-imagine-video-1.5-preview",
  "input_modalities": ["text", "image"],
  "output_modalities": ["video"],
  "aliases": ["grok-imagine-video-1.5-2026-05-30"]
}
```

Important:

- The metadata endpoint reports broad modalities only.
- It does not distinguish image-to-video from reference-to-video.
- It does not expose per-mode capability flags such as `supports_reference_images`, `supports_edits`, or `supports_extensions`.

## Live REST Smoke Findings

Validated through local progrok proxy on 2026-06-01:

| Case | Result |
|---|---|
| `grok-imagine-video-1.5-preview` + `reference_images: [{url: data:image/png}, {url: data:image/png}]` | HTTP 400, `` `reference_images` is not supported for this model. `` |
| `grok-imagine-video-1.5-preview` + `reference_images: [{url: data:video/mp4}, {url: data:image/png}]` | HTTP 400, same unsupported error |
| `grok-imagine-video-1.5-preview` + `reference_images: ["data:image/png", "data:image/png"]` | HTTP 422, invalid type string, expected `ImageUrl` struct |
| `grok-imagine-video-1.5-preview` + `image: {url: data:video/mp4}` | request starts, then polling fails: `Unable to process input image for video generation.` |
| `grok-imagine-video-1.5-preview` + `video` field on `/v1/videos/generations` | HTTP 400, `Text-to-video is not supported for this model.` |

Interpretation:

- 1.5-preview supports image input broadly, but live REST does not support `reference_images`.
- 1.5-preview does not accept video as a reference input.
- `reference_images` must be object-based, not a string array.
- Official docs and community posts can describe a model family or UI capability more broadly than the current REST contract exposed to this account/team.

## X / Community Claims

progrok X search found community posts claiming:

- Grok Imagine Video 1.5 Preview is a reference-to-video model.
- It supports multiple reference images.
- It appears in ComfyUI/fal/Venice-style ecosystem references.
- It topped or ranked strongly in image-to-video arenas.

These claims are useful as market/community signals, but they conflict with the direct REST smoke for this account/team.

Trust handling:

- X/community claims: level C unless backed by official docs or live REST.
- Wrapper/provider claims: level B if they expose their own API and examples.
- Official xAI docs: level A.
- Live xAI REST smoke: level A for the tested account/team at the tested time.

## Current Contract Decision For ima2

Use live REST + official docs as the immediate implementation contract:

| Model | T2V | I2V | Ref2V | Video input | Edit | Extend | Contract decision |
|---|---:|---:|---:|---:|---:|---:|---|
| `grok-imagine-video` | yes | yes | yes | via edit/extend | yes | yes | full current Grok adapter |
| `grok-imagine-video-1.5-preview` | no native prompt-only; can use white-canvas fallback | yes | no in live REST | no | no | no | I2V/frame-anchor-only adapter |

Do not infer Ref2V support for 1.5-preview from `input_modalities: ["text", "image"]`.

Do not infer REST support from X/community claims when live REST rejects the payload.

## Skill / CLI Consequence

Skill wording should say:

- `grok-imagine-video`: T2V, I2V, Ref2V, edit, extend.
- `grok-imagine-video-1.5-preview`: high-quality I2V / frame-anchor continuity only in current ima2 contract.
- 1.5 prompt-only generation is implemented as a generated image-anchor fallback, not native T2V.
- 1.5 Ref2V, video reference, edit, and extension are not supported until a future live smoke proves otherwise.
- `@Image1` / `@Image2` are not xAI REST binding syntax; ima2 must resolve aliases into `AssetRef` payloads itself.

## Open Risk

The public documentation and model behavior may be in rollout flux. xAI may enable `reference_images` for 1.5-preview later. Therefore:

- keep a dated live-smoke table,
- keep `experimental` flags separate from default capabilities,
- prefer runtime capability probing before enabling new modes automatically.
