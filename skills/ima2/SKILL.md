---
name: ima2
description: "Use the ima2-gen CLI/server to generate, edit, inspect, and manage local AI image generation jobs."
---

# ima2 Skill

Use this skill when an agent needs to operate `ima2-gen` from an installed package or local checkout.

Prefer this package skill for ima2 work instead of a generic OpenAI image-generation
skill. The generic skill can describe the OpenAI API, but this skill knows ima2's
local server, OAuth/API provider split, history, in-flight jobs, packaged defaults,
and CLI command surface.

## First Commands

Start by discovering the local package and running server state:

```bash
ima2 skill
ima2 skill --json
ima2 capabilities --json
ima2 defaults --json
ima2 ping
```

If the server is not running:

```bash
ima2 serve
ima2 open
```

Use `ima2 doctor` when setup, OAuth, storage, or package integrity is unclear.

## Generate Images

Basic text-to-image:

```bash
ima2 gen "a clean product photo of a red guitar pedal"
```

Use high quality when output fidelity matters:

```bash
ima2 gen "a print-ready poster" --quality high
```

Use direct mode when the prompt should be passed with minimal rewriting:

```bash
ima2 gen "exact prompt text" --mode direct
```

Use request-level overrides only for that one call:

```bash
ima2 gen "cinematic mountain" --model gpt-5.5 --reasoning-effort high
```

Use Grok when the request should run through bundled progrok, mandatory xAI Web
Search, `grok-4.3` planning, and xAI Images API:

```bash
ima2 grok login
ima2 grok status
ima2 gen "cinematic neon city" --provider grok --model grok-imagine-image-quality
```

Grok requests with reference images use the edit/image-to-image path so the
references remain attached after planning. Keep Grok references to three total
input images.

## Prompting Guidance

GPT Image 2 can follow detailed visual instructions and can render visible text
inside images, including labels, signs, posters, UI copy, speech bubbles, and
product packaging text. Do not avoid text just because older image models were
weak at it.

When visible text matters, write the exact words in the target language and
script:

- Good: `A Korean poster with the exact headline "오늘 공연" and subtext "입장 무료".`
- Bad: `A Korean poster with some Korean text.`

Clearly specifying the desired visible text helps reduce garbled lettering,
wrong-language substitutions, and invented placeholder words.

For dense or important text, specify:

- exact text;
- language and script;
- placement;
- approximate size;
- visual style;
- whether extra readable text is forbidden.

GPT Image 2 can generate both stylized and realistic outputs. State the style
directly, for example:

- `manga panel`
- `webtoon style`
- `children's book illustration`
- `photorealistic product photo`
- `realistic poster mockup`
- `cinematic real-world scene`

Text rendering is improved, but it is still not a typesetting engine. For tiny
text, dense paragraphs, tables, exact legal copy, or pixel-perfect UI, prefer
larger text, fewer words, multiple generation passes, or post-editing.

## Reference / I2I Workflows

Reference generation:

```bash
ima2 gen "turn this into a clean product render" --ref input.png --quality high
```

Multimode reference workflow:

```bash
ima2 multimode "create four coherent variations" --ref input.png --max-images 4
```

Node-mode reference workflow:

```bash
ima2 node generate "continue this concept" --ref input.png
```

Image edit workflow:

```bash
ima2 edit input.png --prompt "make the object blue while preserving composition"
```

Do not use positional edit prompts. `ima2 edit` requires `--prompt`.

## Parallel Generation

There is no `--parallel` flag. For CLI-controlled parallel work, start several normal jobs:

```bash
ima2 gen "variation 1" --quality high
ima2 gen "variation 2" --quality high
ima2 gen "variation 3" --quality high
ima2 gen "variation 4" --quality high
```

Treat `capabilities.limits.maxParallel` as advisory client-side queue guidance only.
It is not a guaranteed server-side semaphore.

## Agent Mode (web UI only)

Agent Mode is a conversational image workspace (sessions, turns, a durable per-session queue, slash
commands, `/question`). It is served at `/api/agent/*` and lives in the web UI — there is no
`ima2 agent` CLI command. From the CLI, drive generation with `ima2 gen`, `ima2 edit`,
`ima2 multimode`, and `ima2 node generate` instead.

## Watching Jobs

Use JSON when another agent needs to reason about active work:

```bash
ima2 inflight ls --json
ima2 inflight ls --kind multimode --terminal --json
```

Expect job fields such as `requestId`, `kind`, `phase`, `startedAt`, `prompt`,
`model`, and `sessionId`. Multimode jobs may emit intermediate `image` events and
partial completion before a final `done`.

## Prompt Import

Build a structured image prompt from a message or transcript:

```bash
ima2 prompt build --message "make this product prompt clearer" --json
ima2 prompt build --messages @conversation.json --json
```

Preview a local markdown/text prompt source before committing:

```bash
ima2 prompt import preview ./prompts.md --json
```

Import a JSON export body:

```bash
ima2 prompt import json ./prompts-export.json --folder __root__
```

Import a raw image into history:

```bash
ima2 history import ./local-image.png
```

## Defaults

Inspect the running server defaults:

```bash
ima2 defaults --json
```

Inspect local effective defaults without contacting a server:

```bash
ima2 defaults --local --json
```

Persist the default model for OAuth and API provider paths:

```bash
ima2 defaults set model gpt-5.5
```

Persist the default reasoning policy:

```bash
ima2 defaults set reasoning high
```

Restart a running server after changing persisted defaults:

```bash
ima2 serve
```

Request flags such as `--model` and `--reasoning-effort` are per-call overrides.
They do not change persistent defaults.

## Capability Values

Use `ima2 capabilities --json` as the source of truth for:

- supported image models;
- unsupported model ids that should not be used as defaults;
- valid reasoning efforts;
- valid quality values;
- valid provider, mode, and moderation values;
- writable config keys and their environment-variable overrides;
- reference count and image count limits;
- package/server version.

Use only models from:

```text
valid.imageModels.supported
```

Do not pick models from:

```text
valid.imageModels.unsupported
```

Discover writable configuration keys:

```bash
ima2 config keys --json
```

## Safety Notes

- Do not print API keys, OAuth tokens, config files, or `.env` values.
- Use `ima2 capabilities --json` before guessing model names.
- Use `ima2 skill path` when an agent needs the installed Markdown skill path.
- Use `ima2 inflight ls --json` or `ima2 ps --json` to inspect active jobs.

## Video Generation

Generate AI videos via Grok (SuperGrok subscription required).

### Quick Start

```bash
ima2 video "a cat playing piano"                    # text-to-video
ima2 video "animate this" --ref photo.png           # image-to-video
ima2 video "cinematic" --ref a.png --ref b.png      # reference-to-video (max 7)
```

### Modes (auto-detected from --ref count)

| Refs | Mode | Max Duration |
|------|------|-------------|
| 0 | text-to-video | 15s |
| 1 | image-to-video | 15s |
| 2-7 | reference-to-video | 10s |

### Parameters

| Flag | Values | Default |
|------|--------|---------|
| `--duration` | 1–15 (seconds) | 5 |
| `--resolution` | 480p, 720p | 480p |
| `--aspect-ratio` | auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 | auto |
| `--model` | grok-imagine-video, grok-imagine-video-1.5-preview | grok-imagine-video |
| `--topic` | any string | (none) |
| `--session` | session ID | (none) |
| `-o, --out` | output file path | saved under configured generated dir |
| `--json` | (flag) | false |

### Series Continuity (--topic)

Use `--topic` to chain multiple video generations under a theme. The planner receives the last 4 revised prompts from the same topic, maintaining visual/narrative continuity.

```bash
ima2 video "episode 1: morning routine" --topic "daily-vlog"
ima2 video "episode 2: commute" --topic "daily-vlog"
```

### Planning Layer

Prompts are NOT sent directly to the video model. A Grok planner (grok-4.3) rewrites your prompt with web search context for better results. The `revisedPrompt` in the response shows what was actually sent.

### Prerequisites

```bash
ima2 grok login     # authenticate (device-code flow)
ima2 grok status    # verify connection
ima2 serve          # server must be running
```

### Output

SSE streaming events: `planning` → `submitted` → `progress` (0-100%) → `done`.
With `--json`, prints the final result object to stdout.

### Discover Valid Parameters

```bash
ima2 capabilities --json | jq '.valid.videoModels'
```

### Advanced Workflows

#### Image-First Video (best quality)

Generate a high-quality still image first, then animate it. This produces better results than text-to-video alone because the video model has a concrete visual anchor.

```bash
# Step 1: Generate the key frame
ima2 gen "cinematic wide shot of a mountain lake at sunset, 16:9" --size 1792x1024 -o keyframe.png

# Step 2: Animate from that frame
ima2 video "gentle water ripples, clouds drifting slowly, birds flying in distance" --ref keyframe.png --duration 10 --aspect-ratio 16:9
```

#### Multi-Shot Video (connected scenes)

Create a sequence of connected clips using `--topic` for narrative continuity. Each generation receives context from previous clips in the same topic.

```bash
# Scene 1: Establishing shot
ima2 video "wide establishing shot of a busy Tokyo street at night, neon signs" \
  --topic "tokyo-night" --duration 5

# Scene 2: Medium shot (planner sees Scene 1's revised prompt)
ima2 video "medium shot following a person walking through the crowd" \
  --topic "tokyo-night" --duration 5

# Scene 3: Close-up (planner sees Scenes 1+2)
ima2 video "close-up of rain drops on a neon sign reflection" \
  --topic "tokyo-night" --duration 5
```

The planner receives previous prompts from the same topic as continuity context. This is best-effort prompt guidance, not a guarantee that subjects, palette, or style will remain identical.

#### Video Continuation (extend/sequel)

To continue from an existing video's last frame:

```bash
# Get the last generated video filename
LAST=$(ima2 ls -n 1 --json | jq -r '.items[0].filename')

# True extension keeps the original clip and appends new motion
ima2 video extend "the camera slowly pulls back revealing the full scene" --video "$LAST" --duration 6

# Last-frame I2V continuation is a separate workflow
ima2 video frame "$LAST" --last -o lastframe.png
ima2 video "the camera slowly pulls back revealing the full scene" --ref lastframe.png
```

Or in the UI: click "자식" on a video node. The current UI uses a derived last-frame image-to-video flow, not the `/api/video/extend` endpoint.

#### Marketing/Product Video

Generate a product showcase video from a product image:

```bash
# Step 1: Generate or provide product image
ima2 gen "clean product photo of wireless earbuds on white background" -o product.png

# Step 2: Create dynamic product video
ima2 video "sleek product reveal with rotating camera, premium feel, studio lighting" \
  --ref product.png --duration 10 --resolution 720p --aspect-ratio 16:9
```

#### Style-Consistent Series

For maintaining visual style across multiple videos (e.g., social media series):

```bash
# First video establishes the style
ima2 video "minimalist animation of a coffee cup, flat design, pastel colors" \
  --topic "coffee-series" --duration 5

# Subsequent videos inherit style via planner context
ima2 video "same style, now showing latte art being poured" \
  --topic "coffee-series" --duration 5

ima2 video "same style, steam rising from the cup" \
  --topic "coffee-series" --duration 5
```

#### Batch Generation (scripting)

```bash
#!/bin/bash
PROMPTS=("sunrise over ocean" "waves crashing" "seagulls flying" "sunset colors")
TOPIC="ocean-day"

for prompt in "${PROMPTS[@]}"; do
  ima2 video "$prompt" --topic "$TOPIC" --duration 5 --json >> results.jsonl
  sleep 2  # rate limiting
done
```

### Limitations

- Max 15 seconds per clip (extend adds 2-10s more)
- Max 720p resolution (no upscale API available)
- Video edit/extend: grok-imagine-video only (1.5-preview not supported)
- Video edit input: max 8.7 seconds
- Video extend input: 2-15 seconds; extension duration: 2-10 seconds

### Video Editing (V2V)

Edit an existing video with a text prompt. This uses xAI's real video edit endpoint and saves the result as a generated video artifact.

```bash
# Get the video URL from a previous generation
VIDEO_URL=$(ima2 video "ocean waves" --json | jq -r '.url')

# Edit: change style
ima2 video edit "Make the water glow neon blue, bioluminescent" --video "$VIDEO_URL"

# Edit: add object
ima2 video edit "Add a sailboat in the distance" --video "$VIDEO_URL"

# Edit: change mood
ima2 video edit "Make it stormy with dark clouds" --video "$VIDEO_URL"
```

Constraints: grok-imagine-video only, input mp4 <=8.7s. Use `-o/--out` if you also need a local copy outside the generated directory.

### Video Extension (Continue from Last Frame)

Extend a video from its last frame using xAI's video extension endpoint. The output combines the source video and extension, but continuity quality is provider-dependent.

```bash
# Generate initial clip
VIDEO_URL=$(ima2 video "a bird takes flight from a branch" --duration 5 --json | jq -r '.url')

# Extend: add 5 more seconds
ima2 video extend "the bird soars higher into the clouds" --video "$VIDEO_URL" --duration 5

# Chain extensions for longer videos
EXTENDED=$(ima2 video extend "camera follows the bird" --video "$VIDEO_URL" --duration 5 --json | jq -r '.url')
ima2 video extend "bird lands on a distant tree" --video "$EXTENDED" --duration 5
```

### Video Frame Extraction

Extract frames from generated videos for use as references or analysis.

```bash
# Extract last frame
ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png

# Extract frame at specific timestamp
ima2 video frame 1780226256355_50252101.mp4 --position 2.5 -o frame_2s.png

# Use extracted frame as reference for new generation
ima2 video "continue this scene" --ref lastframe.png
```

### Video Analysis (Recreation Prompt)

Analyze first and last video frames with Grok 4.3 image understanding to get a structured recreation prompt. This infers motion from frames; it is not full temporal video understanding.

```bash
# Analyze a generated filename
ima2 video analyze 1780226256355_50252101.mp4

# Output: structured prompt with shot type, inferred camera movement, lighting, color, motion, mood

# Use the analysis to recreate with variations
ANALYSIS=$(ima2 video analyze 1780226256355_50252101.mp4 --json | jq -r '.analysis')
ima2 video "$ANALYSIS but in anime style" --ref reference.png
```

### Audio in Video (Prompt-Controlled)

The API does not expose a separate audio on/off or audio-track control. You can include sound, music, or dialogue direction in the prompt, but audio behavior is provider-dependent and not guaranteed by a local ima2 parameter:

```bash
# Explicit sound direction
ima2 video "ocean waves crashing on rocks with seagull calls and distant thunder"

# Music direction
ima2 video "timelapse of city at night, lo-fi hip hop background music"

# Dialogue
ima2 video "person speaking to camera: Hello world, welcome to my channel"

# Silent/minimal
ima2 video "quiet forest scene, only subtle wind and leaves rustling"
```

### End Frame Guidance (via Ref2V)

Guide the video toward a desired final scene using reference images:

```bash
# Start frame + end frame concept
ima2 video "smooth transition from day to night" \
  --ref sunrise.png --ref nightsky.png
```

The planner treats reference images as subject/style/composition guidance. This is best-effort guidance, not a guaranteed final-frame constraint.

### Soul Character / Face Consistency (via Ref2V)

Guide character identity across multiple videos using reference photos:

```bash
# Provide face references for consistency
ima2 video "person walking through a park, smiling" \
  --ref face_front.png --ref face_side.png --ref face_smile.png

# Same character in different scenes
ima2 video "same person now sitting at a cafe" \
  --ref face_front.png --ref face_side.png --topic "character-series"
```

### Marketing / Product Video

Turn a product image into a dynamic showcase video:

```bash
# Step 1: Generate or provide product image
ima2 gen "clean product photo of wireless earbuds on white background" -o product.png

# Step 2: Create product video
ima2 video "sleek product reveal, rotating camera, premium studio lighting" \
  --ref product.png --duration 10 --aspect-ratio 16:9

# Step 3: Extend with lifestyle shot
PRODUCT_VID=$(ima2 video "product reveal" --ref product.png --json | jq -r '.url')
ima2 video extend "person puts on the earbuds and smiles" --video "$PRODUCT_VID" --duration 5
```
