# Grok Video API Endpoint Matrix

Date: 2026-06-01

## Purpose

Clarify which xAI Grok video workflows use which REST endpoints, and separate native model support from ima2 fallback behavior.

## Source Evidence

- Official xAI Imagine overview: https://docs.x.ai/developers/model-capabilities/imagine
- Official xAI video examples use `POST /v1/videos/generations` for image-to-video and `GET /v1/videos/{request_id}` for polling.
- Official xAI overview lists video generation, video editing, reference-to-video, and video extension as separate workflows.
- progrok live smoke matrix records the canonical REST shapes and current live verdicts.
- ima2 route/code verification:
  - `/Users/jun/Developer/new/700_projects/ima2-gen/lib/grokVideoAdapter.ts`
  - `/Users/jun/Developer/new/700_projects/ima2-gen/routes/videoExtended.ts`
  - `/Users/jun/Developer/new/700_projects/progrok/src/commands/capabilities.ts`

## Endpoint Matrix

| Workflow | xAI REST endpoint | Request input shape | `grok-imagine-video` | `grok-imagine-video-1.5-preview` | ima2/progrok route | Notes |
|---|---|---|---:|---:|---|---|
| T2V | `POST /v1/videos/generations` | `model`, `prompt`, `duration`, optional `aspect_ratio`, `resolution` | supported | not native in current live smoke; ima2 uses canvas I2V fallback | `POST /api/video/generate`; `ima2 video <prompt>` | 1.5 prompt-only T2V failed live, so ima2 injects a white canvas and sends I2V when no image/ref exists. |
| I2V | `POST /v1/videos/generations` | `model`, `prompt`, `image: { url | file_id }`, `duration` | supported | supported | `POST /api/video/generate`; `ima2 video <prompt> --image <input>` | The source image becomes the first frame. |
| Ref2V / R2V | `POST /v1/videos/generations` | `model`, `prompt`, `reference_images: [{ url | file_id }]` | supported; max 7 refs, max 10s observed | failed in progrok live smoke; not confirmed as supported | `POST /api/video/generate`; `ima2 video <prompt> --ref ...` | Do not claim 1.5 Ref2V support until a fresh live smoke proves it. |
| V2V edit | `POST /v1/videos/edits` | `model`, `prompt`, `video: { url | file_id }` | supported | unsupported/rejected by ima2 route | `POST /api/video/edit`; `ima2 video edit <prompt> --video <input>` | Different endpoint from I2V. Input must be mp4; xAI docs state max 8.7s for `video_url`; output preserves duration/aspect and caps resolution at 720p. |
| Extension | `POST /v1/videos/extensions` | `model`, `prompt`, `video: { url | file_id }`, `duration` | supported | unsupported/rejected by ima2 route | `POST /api/video/extend`; `ima2 video extend <prompt> --video <input>` | Extends from last frame and returns combined original + extension. ima2 validates duration 2-10. |
| Polling | `GET /v1/videos/{request_id}` | request id | supported | supported for submitted jobs | internal polling | All async video workflows poll the same endpoint. |
| Model list | `GET /v1/video-generation-models` | none | model metadata | model metadata | progrok capability surface | Useful for future capability discovery; ima2 currently relies on explicit allowlists. |
| Model detail | `GET /v1/video-generation-models/{model_id}` | model id | model metadata | model metadata | progrok capability surface | Future adapter should prefer this when available. |

## Important Distinctions

### I2V is not V2V edit

I2V:

```text
POST /v1/videos/generations
image: { url | file_id }
```

V2V edit:

```text
POST /v1/videos/edits
video: { url | file_id }
```

They are separate REST workflows.

### 1.5 preview support is narrower

Current validated support:

- `grok-imagine-video-1.5-preview` works for I2V through `POST /v1/videos/generations`.
- Native prompt-only T2V failed in live smoke; ima2 uses a white-canvas I2V fallback.
- `reference_images` / Ref2V failed in progrok live smoke and should be treated as not supported until revalidated.
- `/v1/videos/edits` and `/v1/videos/extensions` are restricted in ima2 to `grok-imagine-video` only.

### Adapter implication

Continuity code must distinguish:

- `executionMode: "native-video-edit"` for `/v1/videos/edits`
- `executionMode: "native-video-extend"` for `/v1/videos/extensions`
- `executionMode: "image-anchor"` for I2V/last-frame workflows on `/v1/videos/generations`
- `executionMode: "reference-images"` for Ref2V on `/v1/videos/generations`
- `executionMode: "fallback-image-anchor"` for 1.5 prompt-only fallback

This prevents the UI/skill from calling 1.5 continuity "V2V" when it is actually frame-anchor I2V.
