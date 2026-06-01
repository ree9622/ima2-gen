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
- `reference_images` / Ref2V fails with xAI HTTP 400: `` `reference_images` is not supported for this model. ``
- Putting `data:video/mp4` inside `reference_images` also fails with the same HTTP 400 before video-type handling.
- Putting `data:video/mp4` inside the I2V `image` field starts a request but the job immediately fails while polling: `Unable to process input image for video generation.`
- Sending a `video` field to `/v1/videos/generations` with 1.5 fails as prompt-only T2V: `Text-to-video is not supported for this model.`
- `/v1/videos/edits` and `/v1/videos/extensions` are restricted in ima2 to `grok-imagine-video` only.

Live 2026-06-01 direct REST smoke through progrok proxy:

| Case | Payload shape | Result |
|---|---|---|
| 1.5 + two PNG refs | `reference_images: [{data:image/png}, {data:image/png}]` | HTTP 400, `` `reference_images` is not supported for this model. `` |
| 1.5 + MP4 in refs | `reference_images: [{data:video/mp4}, {data:image/png}]` | HTTP 400, `` `reference_images` is not supported for this model. `` |
| 1.5 + MP4 as `image` | `image: {data:video/mp4}` | start HTTP 200 with request id, then poll `failed`: `Unable to process input image for video generation.` |
| 1.5 + `video` on generations | `video: {data:video/mp4}` | HTTP 400, `Text-to-video is not supported for this model.` |
| 1.5 + string-array refs | `reference_images: ["data:image/png", "data:image/png"]` | HTTP 422, `reference_images[0]: invalid type: string ..., expected struct ImageUrl` |

The currently accepted REST shape for references is object-based:

```json
{
  "reference_images": [
    { "url": "https://example.com/ref1.jpg" },
    { "url": "https://example.com/ref2.jpg" }
  ]
}
```

The string-array shape shown in some examples is not accepted by the tested xAI REST surface.

### Adapter implication

Continuity code must distinguish:

- `executionMode: "native-video-edit"` for `/v1/videos/edits`
- `executionMode: "native-video-extend"` for `/v1/videos/extensions`
- `executionMode: "image-anchor"` for I2V/last-frame workflows on `/v1/videos/generations`
- `executionMode: "reference-images"` for Ref2V on `/v1/videos/generations`
- `executionMode: "fallback-image-anchor"` for 1.5 prompt-only fallback

This prevents the UI/skill from calling 1.5 continuity "V2V" when it is actually frame-anchor I2V.
