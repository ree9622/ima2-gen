# API Reference

This document lists the local HTTP API exposed by `ima2 serve`.

Base URL:

```text
http://localhost:3333
```

## Provider Policy

Image generation supports OAuth, API-key, and Grok providers.

- `provider: "oauth"` uses the local Codex OAuth proxy.
- `provider: "api"` uses the OpenAI Responses API with the hosted `image_generation` tool.
- `provider: "grok"` uses the bundled progrok xAI proxy. Classic, Node, and Agent generation run mandatory xAI Web Search through `/v1/responses`, then run a `grok-4.3` planner call with a forced local `generate_image` function, then ima2 executes xAI `/v1/images/generations`. If reference images, a Node parent image, or an Agent current image are attached, the final step switches to xAI `/v1/images/edits` so image-to-image context is preserved.
- API-key generation covers classic generate, edit, mask-guided edit, multimode, and node generation.
- If `provider: "api"` is requested without an API key, routes fail before upstream with `401` and `API_KEY_REQUIRED`.
- Grok generation maps `size` to xAI `aspect_ratio` and `resolution`; it does not send an OpenAI-style `size` field upstream. Grok edit uses xAI `/v1/images/edits`; Grok mask edit remains unsupported and returns `GROK_MASK_UNSUPPORTED`.
- Mask edits are mask/selection guided edits, not pixel-perfect inpaint guarantees.

Grok video generation uses `POST /api/video/generate` (SSE). See the Video
Generation section below for the full endpoint specification.

## Health And Status

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Server health, version, paths, provider policy |
| `GET` | `/api/providers` | Provider availability and runtime ports |
| `GET` | `/api/oauth/status` | OAuth proxy status and visible models |
| `GET` | `/api/grok/status` | Bundled progrok status and visible xAI image models |
| `GET` | `/api/billing` | Billing/status probe, including API key source when configured |

## Storage

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/storage/status` | Summarized gallery storage status for support UI |
| `POST` | `/api/storage/open-generated-dir` | Ask the server process to open the generated image folder |

`GET /api/storage/status` returns a support-safe summary, not raw legacy path arrays by default.

```json
{
  "ok": true,
  "data": {
    "generatedDirLabel": "~/.ima2/generated",
    "generatedCount": 0,
    "legacyCandidatesScanned": 18,
    "legacySourcesFound": 0,
    "legacyFilesFound": 0,
    "state": "not_found",
    "messageKind": "apology",
    "recoveryDocsPath": "docs/RECOVER_OLD_IMAGES.md",
    "doctorCommand": "ima2 doctor",
    "overrides": {
      "generatedDir": false,
      "configDir": false
    }
  }
}
```

Storage `state` values:

| State | Meaning |
|---|---|
| `ok` | Current gallery has files or no recovery notice is needed |
| `recoverable` | Legacy folders/files are still present and may be recoverable |
| `not_found` | Current gallery is empty and no legacy folder was found |
| `unknown` | Storage status inspection failed or was incomplete |

`POST /api/storage/open-generated-dir` opens the generated image folder on the machine running `ima2 serve`. If the browser is connected to a remote server, VM, container, WSL instance, or another computer on the network, this action targets that server machine, not necessarily the browser device.

## In-Flight Jobs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/inflight` | Active jobs only by default |
| `GET` | `/api/inflight?includeTerminal=1` | Includes recent terminal jobs for debugging |
| `DELETE` | `/api/inflight/:requestId` | Cancel or forget an active job |

In-flight logs and responses use `requestId` for correlation. Logs should not include raw prompts, reference data URLs, generated base64, tokens, cookies, auth headers, or raw upstream bodies.

## Generation

### `POST /api/generate`

Text-to-image and reference-guided root generation.

```json
{
  "prompt": "a shiba in space",
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "provider": "oauth",
  "model": "gpt-5.4",
  "references": [],
  "requestId": "optional-client-id"
}
```

Supported quality values: `low`, `medium`, `high`.

Supported moderation values: `auto`, `low`.

Recommended model: `gpt-5.4`. Current app default: `gpt-5.4-mini`. `gpt-5.5` is the strongest quality option when supported, but callers should expect higher quota pressure and possible Codex CLI/backend capability requirements.

When `provider` is `"grok"`, supported models are `grok-imagine-image` and
`grok-imagine-image-quality`. The server uses `grok-4.3` as the search/planner
model by default (`IMA2_GROK_PLANNER_MODEL`) and times the mandatory search and
planner steps separately from the image call (`IMA2_GROK_PLANNER_TIMEOUT_MS`).
For `n > 1`, search and planning run once and the planned prompt is reused for
the image requests. Successful Grok classic generations report one mandatory
web-search call in metadata.

If `references` are present on a Grok classic request, ima2 still performs the
mandatory search and `grok-4.3` planning phases. The planner receives the
reference images as multimodal `image_url` inputs, and its forced
`generate_image.prompt` argument is instructed to be English-only except for
exact visible text requested by the user. The final image call then uses xAI
`/v1/images/edits` with the same reference images instead of
`/v1/images/generations`. This keeps image-to-image/reference context alive
through the three-phase pipeline. xAI currently documents up to three source
images for image editing, so Grok classic requests with more than three
references return `GROK_REF_TOO_MANY`.

Grok size mapping:

| Requested size | xAI `aspect_ratio` | xAI `resolution` |
|---|---|---|
| `1024x1024` | `1:1` | `1k` |
| `1536x1024` | `3:2` | `1k` |
| `1024x1536` | `2:3` | `1k` |
| `1360x1024` | `4:3` | `1k` |
| `1024x1360` | `3:4` | `1k` |
| `1824x1024` | `16:9` | `1k` |
| `1024x1824` | `9:16` | `1k` |
| `2048x2048` | `1:1` | `2k` |
| `2048x1152` | `16:9` | `2k` |
| `1152x2048` | `9:16` | `2k` |
| `3840x2160` | `16:9` | `2k` |
| `2160x3840` | `9:16` | `2k` |
| `auto` | `auto` | omitted |

Custom sizes are reduced to the closest xAI-supported aspect ratio and use
`2k` when the requested longest edge or pixel budget is closer to a 2K image.

### `POST /api/edit`

Image edit / image-to-image generation.

The request includes a prompt and image payload. `provider: "api"` sends the prompt and image through the shared Responses image adapter. Optional masks are forwarded as mask guidance, not a pixel-perfect edit guarantee.

With `provider: "grok"`, edit requests are sent to xAI `/v1/images/edits`
through the bundled progrok proxy. Masked Grok edits are rejected before
upstream with `GROK_MASK_UNSUPPORTED`.

Grok multimode currently sends each image request directly to xAI Images API
with the mapped `aspect_ratio`/`resolution`; the mandatory search + planner
pipeline is limited to classic `/api/generate`.

### `POST /api/node/generate`

Node-mode generation and child edits.

Body fields:

```json
{
  "parentNodeId": "optional-server-node-id",
  "prompt": "continue this image",
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "model": "grok-imagine-image",
  "references": [],
  "externalSrc": "optional-history-url",
  "sessionId": "session-id",
  "clientNodeId": "client-node-id",
  "requestId": "request-id",
  "provider": "grok"
}
```

When `parentNodeId` is present, the server loads the stored parent node image and uses the edit path. Extra node references are currently supported only for root nodes.

With `provider: "grok"`, Node Mode uses the same xAI search + `grok-4.3` planner + Images API pipeline as classic generation. A parent node image, `externalSrc`, or extra references are passed to the planner and then to xAI `/v1/images/edits`; otherwise the final call uses `/v1/images/generations`. Grok Node requests are capped at three total input images, counting the parent/current image plus references, and return `GROK_REF_TOO_MANY` before upstream when that limit is exceeded. `quality: "high"` promotes the final image model to `grok-imagine-image-quality`.

The route can stream Server-Sent Events when the client sends `Accept: text/event-stream`. Possible events include `phase`, `partial`, `done`, and `error`.

Grok Node SSE responses do not include Responses API `partial` image events because the xAI Images API call is synchronous JSON. They still emit `phase` and `done`/`error` events so the Node UI can use the same in-flight lifecycle.

### `GET /api/node/:nodeId`

Fetch stored node metadata and asset URL.

## Reference Images

Reference uploads are capped at 5 items. The frontend compresses large JPEG/PNG files before sending them. HEIC/HEIF files are rejected with a user-facing conversion hint.

Server-side validation may return these reference codes:

| Code | Meaning |
|---|---|
| `REF_NOT_ARRAY` | `references` was not an array |
| `REF_TOO_MANY` | More than the configured reference count |
| `REF_NOT_STRING` | A reference item was not a string |
| `REF_EMPTY` | A reference item was empty |
| `REF_TOO_LARGE` | A reference exceeded the configured base64 size |
| `REF_NOT_BASE64` | A reference was not valid base64 |
| `GROK_REF_TOO_MANY` | Grok classic generation received more than three reference images |
| `GROK_MASK_UNSUPPORTED` | Grok edit was requested with a mask; xAI mask edit is not wired in this release |

## Video Generation

### `POST /api/video/generate` (SSE)

Generate a video via the Grok video provider. Returns Server-Sent Events.

```json
{
  "prompt": "a cat playing piano",
  "provider": "grok",
  "model": "grok-imagine-video",
  "duration": 5,
  "resolution": "480p",
  "aspectRatio": "auto",
  "sourceImage": "<base64>",
  "referenceImages": ["<base64>", "<base64>"],
  "referenceFilenames": ["existing-file.png"],
  "continueFromVideo": "1780226256355_50252101.mp4",
  "continuityLineage": { "lineageId": "optional-client-hint", "entries": [] },
  "sessionId": "optional",
  "requestId": "optional-client-id"
}
```

**Models**: `grok-imagine-video` (default), `grok-imagine-video-1.5-preview`.

**Mode** is auto-detected from reference inputs:

| Inputs | Mode | Duration cap |
|---|---|---|
| No images | text-to-video | 1–15s |
| 1 image (`sourceImage` or `sourceFilename`) | image-to-video | 1–15s |
| 2–7 images (`referenceImages` / `referenceFilenames`) | reference-to-video | 1–10s |

**Parameters**:

| Field | Type | Default | Notes |
|---|---|---|---|
| `prompt` | string | — | Required |
| `provider` | string | `"grok"` | Must be `"grok"` |
| `model` | string | `grok-imagine-video` | Video model |
| `duration` | integer | `5` | 1–15 seconds (clamped to 10 for reference-to-video) |
| `resolution` | string | `"480p"` | `480p` or `720p` |
| `aspectRatio` | string | `"auto"` | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto |
| `sourceImage` | string | — | Base64 image for image-to-video |
| `sourceFilename` | string | — | Existing generated file for image-to-video |
| `referenceImages` | string[] | — | Base64 images for reference-to-video |
| `referenceFilenames` | string[] | — | Existing generated files for reference-to-video |
| `continueFromVideo` | string | — | Generated `.mp4` parent; server extracts its last frame and rebuilds lineage from sidecar |
| `continuityLineage` | object | — | Optional client hint; used only when `continueFromVideo` is absent |

Blank prompts return `PROMPT_REQUIRED` with a `guidance` string. The active
prompt should describe visual flow, motion flow, sound/music/no-music,
dialogue/no-dialogue, and ending frame.

When `continueFromVideo` is present, the server treats the generated `.mp4`
sidecar as authoritative. Client `continuityLineage` cannot override it. The
saved child sidecar includes `videoContinuity`, a branch-local max-4 stack using
`keep-start-plus-latest-3` retention.

`videoContinuity` shape:

```json
{
  "lineageId": "lineage:parent",
  "parentFilename": "parent.mp4",
  "sourceFrame": "last",
  "maxEntries": 4,
  "retention": "keep-start-plus-latest-3",
  "entries": [
    {
      "id": "clip:parent.mp4",
      "ordinal": 1,
      "role": "start",
      "filename": "parent.mp4",
      "userPrompt": "original user prompt",
      "revisedPrompt": "planner prompt actually sent to Grok video",
      "createdAt": 1780300000000
    }
  ]
}
```

Entry `role` is `start`, `ancestor`, `parent`, or `current`. The first clip is
kept as the start anchor; later generations keep only the latest three entries.
`lineageId` uses the generated video basename without the `.mp4` extension.
This metadata is stored in the generated `.mp4.json` sidecar and returned in
history rows and video `done` events; `/generated/*.json` remains private.

Grok prompt surfaces used by video APIs:

| Surface | Model | Responsibility |
|---|---|---|
| Video planner | `grok-4.3` | Converts user prompt, search context, refs, and optional continuity lineage into the final English video prompt. It must structure core subject, action/motion, camera/composition, environment/style, dialogue/audio, ending-frame handoff, and constraints. |
| Video generation | xAI video model | Receives the planner prompt plus `sourceImage` or `referenceImages` when present. |
| Video analysis | `grok-4.3` | Reads first/last frame images from `/api/video/analyze` and returns recreation/continuation guidance. |

**SSE events**:

| Event | Data | Description |
|---|---|---|
| `planning` | `{ requestId }` | Preparing video generation |
| `submitted` | `{ requestId, xaiVideoRequestId, requestedModel, effectiveModel, modelFallback }` | Submitted to xAI |
| `progress` | `{ requestId, progress, stalled }` | Progress 0.0–1.0 |
| `done` | `{ requestId, filename, url, mediaType, revisedPrompt, elapsed, usage, requestedModel, effectiveModel, modelFallback, video, videoContinuity }` | Video ready |
| `error` | `{ error, code, status, requestId, guidance? }` | Generation failed |

**Video error codes**:

| Code | Meaning |
|---|---|
| `VIDEO_PROVIDER_UNSUPPORTED` | Provider is not `"grok"` |
| `PROMPT_REQUIRED` | Empty or missing prompt |
| `INVALID_GROK_VIDEO_MODEL` | Model not in valid set |
| `INVALID_VIDEO_RESOLUTION` | Resolution not 480p or 720p |
| `INVALID_VIDEO_ASPECT_RATIO` | Aspect ratio not in valid set |
| `INVALID_VIDEO_DURATION` | Duration not 1–15 integer |
| `GROK_VIDEO_REF_TOO_MANY` | More than 7 reference images |
| `GROK_VIDEO_FAILED` | Upstream xAI video generation failed |
| `GROK_VIDEO_FRAME_FAILED` | Server could not extract the parent video's last frame |

### `POST /api/video/edit`

Edit an existing video via Grok V2V. This is a blocking JSON endpoint that starts the xAI edit job, polls it, downloads the final MP4, and saves it as a generated video artifact.

```json
{
  "prompt": "make it sunset",
  "videoUrl": "https://vidgen.x.ai/.../clip.mp4",
  "model": "grok-imagine-video"
}
```

`videoUrl` may be an HTTPS video URL, xAI `file_id`, `data:video/*` URL, or generated `.mp4` filename. Generated-file inputs are restricted to real `.mp4` files under the generated directory.

### `POST /api/video/extend`

Extend a video from its last frame. This is a blocking JSON endpoint that starts the xAI extension job, polls it, downloads the combined output MP4, and saves it as a generated video artifact.

```json
{
  "prompt": "camera pulls back",
  "videoUrl": "1780226256355_50252101.mp4",
  "duration": 6,
  "model": "grok-imagine-video"
}
```

`duration` must be an integer from 2 to 10 seconds. Edit and extension support `grok-imagine-video` only; `grok-imagine-video-1.5-preview` is not accepted for these endpoints.

### `GET /api/video/frame`

Extract a PNG frame from a generated `.mp4` file.

| Query | Notes |
|---|---|
| `file` | Required generated `.mp4` filename or generated-dir absolute path |
| `position` | `last` (default) or non-negative seconds |

### `POST /api/video/analyze`

Analyze first and last frames from a generated `.mp4` using Grok 4.3 image understanding. This does not upload the video as temporal video; it extracts two PNG frames and asks the vision model to infer likely motion.

```json
{
  "videoUrl": "1780226256355_50252101.mp4"
}
```

Remote URLs and `data:` inputs are intentionally rejected to avoid server-side URL fetching through `ffmpeg`.

## History

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/history` | List generated assets |
| `GET` | `/api/history?groupBy=session` | Group assets by session title |
| `DELETE` | `/api/history/:filename` | Tombstone a generated asset |
| `POST` | `/api/history/:filename/restore` | Restore a recently deleted asset |

History rows can include node metadata such as `sessionId`, `nodeId`, `clientNodeId`, `requestId`, and `refsCount`.

## Sessions And Graphs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sessions` | List graph sessions |
| `POST` | `/api/sessions` | Create a session |
| `GET` | `/api/sessions/:id` | Load a session and graph |
| `PATCH` | `/api/sessions/:id` | Rename a session |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `PUT` | `/api/sessions/:id/graph` | Save graph snapshot |

`PUT /api/sessions/:id/graph` requires an `If-Match` header containing the current graph version.

Version mismatch returns `GRAPH_VERSION_CONFLICT` and the current version. This only means the client saved against a stale graph version; it is not proof that another browser tab changed the graph.

Graph save requests may include observability headers:

```text
X-Ima2-Graph-Save-Id
X-Ima2-Graph-Save-Reason
X-Ima2-Tab-Id
```

## Style Sheets

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sessions/:id/style-sheet` | Load session style sheet |
| `PUT` | `/api/sessions/:id/style-sheet` | Save style sheet |
| `PATCH` | `/api/sessions/:id/style-sheet/enabled` | Toggle style sheet usage |
| `POST` | `/api/sessions/:id/style-sheet/extract` | Extract style fields from prompt/reference |

Style-sheet extraction can require an API key/openai client. Image generation also supports `provider: "api"` through the shared Responses API image adapter when an API key is configured.

## Common Error Codes

| Code | Meaning |
|---|---|
| `API_KEY_REQUIRED` | `provider: "api"` was requested without a configured API key |
| `APIKEY_DISABLED` | Legacy/deprecated hard-block code from older builds |
| `INVALID_IMAGE_MODEL` | Model name is unknown or unsupported |
| `IMAGE_MODEL_UNSUPPORTED` | Model exists but cannot use image generation |
| `INVALID_REQUEST` | Upstream request parameters are invalid; raw provider details may be included as `upstreamCode`, `upstreamType`, and `upstreamParam` |
| `INVALID_MODERATION` | Moderation value is not `auto` or `low` |
| `SAFETY_REFUSAL` | Upstream safety refusal |
| `MODERATION_REFUSED` | Content generation refused by moderation |
| `AUTH_CHATGPT_EXPIRED` | Codex/ChatGPT OAuth session expired |
| `AUTH_API_KEY_INVALID` | API key is invalid, revoked, out of quota, or wrong org |
| `NETWORK_FAILED` | Network, proxy, VPN, or firewall failure |
| `OAUTH_UNAVAILABLE` | Local OAuth proxy is not available |
| `OPEN_GENERATED_DIR_FAILED` | The server could not open the generated image folder |
| `GRAPH_VERSION_REQUIRED` | Missing graph `If-Match` header |
| `GRAPH_VERSION_CONFLICT` | Stale graph version |
| `GRAPH_TOO_LARGE` | Graph exceeds node/edge limits |
| `NODE_NOT_FOUND` | Node metadata was not found |
| `INVALID_GROK_IMAGE_MODEL` | A Grok request used a model outside `grok-imagine-image` or `grok-imagine-image-quality` |
| `GROK_RATE_LIMITED` | xAI returned a rate-limit response through progrok |
| `GROK_AUTH_FAILED` | progrok could not authenticate the xAI request |
| `GROK_SEARCH_TIMEOUT` / `GROK_PLANNER_TIMEOUT` / `GROK_IMAGE_TIMEOUT` | The Grok search, planner, or image API step exceeded its timeout budget |

## Endpoint → CLI Mapping

Most server routes under `/api/*` have a CLI wrapper. The exception is **Agent Mode** (`/api/agent/*`), which is server + web-UI-only and has no `ima2` subcommand. The prompt builder HTTP route (`POST /api/prompt-builder/chat`) is wrapped by `ima2 prompt build`. Use this table to find the command that calls a given endpoint. (See README.md "Client" section for full flag lists.)

| Endpoint | CLI |
|---|---|
| `POST /api/generate` | `ima2 gen` |
| `POST /api/edit` | `ima2 edit` |
| `POST /api/generate/multimode` (SSE) | `ima2 multimode` |
| `POST /api/video/generate` (SSE) | `ima2 video` |
| `POST /api/video/generate` with `continueFromVideo` | `ima2 video continue` |
| `POST /api/video/edit` | `ima2 video edit` |
| `POST /api/video/extend` | `ima2 video extend` |
| `GET /api/video/frame` | `ima2 video frame` |
| `POST /api/video/analyze` | `ima2 video analyze` |
| `POST /api/node/generate` (SSE) / `GET /api/node/:id` | `ima2 node generate` / `ima2 node show` |
| `GET /api/history` | `ima2 ls` |
| `DELETE /api/history/:name` / `…/permanent` | `ima2 history rm [--permanent]` |
| `POST /api/history/restore` | `ima2 history restore --trash-id` |
| `POST /api/history/favorite` | `ima2 history favorite` |
| `POST /api/history/import-local` | `ima2 history import` |
| `POST /api/metadata/read` | `ima2 metadata` / `ima2 show --metadata` |
| `GET/POST/PUT/DELETE /api/sessions[/…]` | `ima2 session ls/show/create/rm/rename` |
| `GET/PUT /api/sessions/:id/graph` | `ima2 session graph load/save` |
| `GET/PUT /api/sessions/:id/style-sheet[/…]` | `ima2 session style-sheet …` |
| `GET/PUT/DELETE /api/annotations/:name` | `ima2 annotate get/set/rm` |
| `POST /api/canvas-versions` / `PUT /api/canvas-versions/:name` | `ima2 canvas-versions save/update` |
| `GET/POST/PUT/DELETE /api/prompts[/…]` | `ima2 prompt …` |
| `GET/POST/PATCH/DELETE /api/prompts/folders[/…]` | `ima2 prompt folder …` |
| `…/api/prompts/import/…` | `ima2 prompt import sources/refresh/curated/discovery/folder` |
| `…/api/cardnews/…` (gated on `features.cardNews`) | `ima2 cardnews …` |
| `POST /api/comfy/export-image` | `ima2 comfy export` |
| `GET /api/inflight` / `DELETE /api/inflight/:id` | `ima2 inflight ls` (alias `ps`) / `ima2 inflight rm` (alias `cancel`) |
| `GET /api/storage/status` / `POST /api/storage/open-generated-dir` | `ima2 storage status` / `ima2 storage open` |
| `GET /api/billing` / `GET /api/providers` / `GET /api/oauth/status` / `GET /api/grok/status` | `ima2 billing` / `ima2 providers` / `ima2 oauth status` / `ima2 grok status` |
| `GET /api/health` | `ima2 ping` |
| `GET /api/capabilities` | `ima2 capabilities` |
| `GET/POST/PATCH/DELETE /api/agent/*` (sessions, turns, queue) | — (Agent Mode; web UI only, no CLI) |
| `POST /api/prompt-builder/chat` | `ima2 prompt build` |

Notes:
- `ima2 history favorite` and `ima2 annotate …` send `X-Ima2-Browser-Id: cli-<sha1prefix>` derived from the config dir, so CLI activity does not collide with browser sessions.
- `ima2 session graph save` performs a GET-then-PUT with `If-Match: "<version>"` to guard against `GRAPH_VERSION_CONFLICT`.
- `ima2 history import` and `ima2 canvas-versions save/update` send raw bytes with `Content-Type: image/<png|jpeg|webp>`; the SSE endpoints (`multimode`, `node generate`) use `Accept: text/event-stream`.
- `ima2 cardnews …` checks `runtimeConfig.features.cardNews` before calling the gated endpoints; when disabled the CLI exits 2 with a clear message instead of producing a 404.

## CLI Discovery

The server writes an advertisement file at:

```text
~/.ima2/server.json
```

CLI commands such as `ima2 ping`, `ima2 gen`, and `ima2 ls` use this file unless `--server` or `IMA2_SERVER` is provided.

Current shape:

```json
{
  "port": 3334,
  "url": "http://localhost:3334",
  "pid": 12345,
  "startedAt": 1777180000000,
  "version": "1.0.0",
  "backend": {
    "configuredPort": 3333,
    "actualPort": 3334,
    "url": "http://localhost:3334"
  },
  "oauth": {
    "configuredPort": 10531,
    "actualPort": 10532,
    "url": "http://127.0.0.1:10532",
    "status": "ready"
  }
}
```

Top-level `port` and `url` are kept for older CLI clients. New code should prefer `backend.url`.
