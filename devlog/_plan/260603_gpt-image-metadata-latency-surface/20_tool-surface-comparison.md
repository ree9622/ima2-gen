# Phase 2 — GPT Image Tool Surface Comparison

Date: 2026-06-03

## Sources

This plan uses three local documents supplied or requested by the user:

```text
/Users/jun/Developer/imagegen-tool-spec-2026-06-02.md
/Users/jun/Developer/chatgptimagetool.md
/Users/jun/Developer/imagegen-tool-comparison-2026-06-03.md
```

## Summary

There are three separate surfaces and they must not be conflated:

| Surface | Runtime | Visible call shape | Can `ima2-gen` directly plug it in? |
| --- | --- | --- | --- |
| Codex built-in image tool | Codex assistant runtime | `image_gen.imagegen({ prompt? })` | No |
| ChatGPT visible image tool | ChatGPT assistant runtime | `image_gen.text2im({ prompt?, size?, n?, transparent_background?, is_style_transfer?, referenced_image_ids? })` | No |
| `ima2-gen` GPT path | local app server | Responses `tools:[{ type:"image_generation", ... }]` | Already implemented |

The first two are platform-hidden assistant tool surfaces. They are useful as workflow references, but they are not public provider APIs that the open-source app server can import or call.

## Codex Built-In Image Tool

Source:

```text
/Users/jun/Developer/imagegen-tool-spec-2026-06-02.md
```

Visible schema:

```ts
type imagegen = (_: {
  prompt?: string | null
}) => any;
```

Important implications:

- Only `prompt` is model-visible.
- No model, endpoint, auth, seed, size, count, transparent background, or output path is exposed.
- Image-to-image behavior depends on conversation-visible image context rather than an explicit local file path parameter.
- This cannot be treated as an API module for `ima2-gen`.

## ChatGPT Visible Image Tool

Source:

```text
/Users/jun/Developer/chatgptimagetool.md
```

Reported visible schema:

```ts
image_gen.text2im({
  prompt?: string | null,
  size?: string | null,
  n?: integer | null,
  transparent_background?: boolean | null,
  is_style_transfer?: boolean | null,
  referenced_image_ids?: string[] | null
})
```

Important implications:

- ChatGPT's visible surface appears more parameterized than Codex's visible surface.
- It exposes direct user-intent controls: `size`, `n`, transparent background, style transfer, and referenced image IDs.
- It still does not expose internal endpoint/auth/model/routing details.
- It also cannot be plugged directly into `ima2-gen`.

## `ima2-gen` GPT Path

Current practical path:

```text
ima2-gen UI/CLI
-> /api/generate
-> generateViaResponses()
-> GPT OAuth/OpenAI-compatible Responses request
-> tools: [{ type: "image_generation", quality, size, moderation }]
-> save output image
-> write metadata sidecar
-> update gallery/history
```

Useful differences:

- `ima2-gen` controls output directory and history.
- `ima2-gen` controls provider/model selection.
- `ima2-gen` has sidecar metadata and thumbnails.
- `ima2-gen` can support CLI copy paths.
- `ima2-gen` can add instrumentation not visible in ChatGPT/Codex tools.

## Workflow Lessons To Port

### Structured Prompt Template

Use in prompt-builder or Auto mode, not as a forced Direct-mode rewrite:

```text
Use case:
Asset type:
Primary request:
Scene/backdrop:
Subject:
Style/medium:
Composition/framing:
Lighting/mood:
Color palette:
Materials/textures:
Text (verbatim):
Constraints:
Avoid:
```

### Reference Role Labels

Add first-class role metadata to references:

```text
edit_target
style_reference
composition_reference
subject_reference
lighting_reference
background_reference
supporting_input
```

The generated prompt should say which image is the edit target, which image is style-only, and which image is composition-only.

### Transparent Background Intent

ChatGPT exposes `transparent_background`; `ima2-gen` currently needs an explicit workflow.

Implementation options:

1. If the underlying Responses image tool exposes a native transparent-background option, map the UI toggle to it.
2. If not, use a chroma-key prompt preset and local background removal.
3. Record the actual method in metadata as `transparentMethod:"native"` or `transparentMethod:"local-chroma-key"`.

### Batch Semantics

Important UX distinction:

- Sequence mode ON: generate different stage prompts, one stage at a time.
- Sequence mode OFF + count > 1: generate the same prompt repeatedly.
- The ChatGPT `n` surface reinforces that count should mean same-request variations, not automatic narrative splitting.

## Non-Goals

- Do not claim access to hidden ChatGPT or Codex internal endpoints.
- Do not invent unsupported parameters for the local GPT OAuth path.
- Do not replace the local Responses implementation with assistant-runtime-only tools.

