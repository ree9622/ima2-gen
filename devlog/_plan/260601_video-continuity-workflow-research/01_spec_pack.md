# Video Continuity Workflow Spec Pack

Date: 2026-06-01

## Decision

Jun selected the recommended path:

- Provider capability matrix now.
- Spec Pack now.
- Implementation in a later phase.
- Ontology must separate audio/dialogue concepts even if the first Grok adapter compiles them into prompts.

This document defines the planning surface required before implementation.

## Scope Boundary

This spec is for a continuity-editing workflow engine, not a simple clip stitcher.

In scope:

- provider capability matrix
- core ontology
- `ContinuityJob`
- `AssetRef`
- `DialogueSpec`
- `FrameAnchor`
- API schema draft
- CLI schema draft
- skill update plan

Out of scope for this spec pack:

- implementing `/api/video/continuity`
- implementing `ima2 video continuity`
- adding external Runway, Higgsfield, or Seedance providers
- claiming Seedance internal architecture beyond public evidence
- live 60s/120s generation smoke

## Provider Capability Matrix

| Provider / Family | Current ima2 status | Video input | Image refs | Audio input | Native audio output | Dialogue / voice surface | V2V / edit | Extend | Continuity implication |
|---|---|---:|---:|---:|---:|---|---:|---:|---|
| Grok Imagine Video | implemented | limited to edit/extend endpoints for base model | yes | no public xAI REST audio input found | yes, model behavior | prompt-compiled dialogue/audio instructions | base model only | base model only | first adapter; structured audio fields compile into prompt |
| Grok Imagine Video 1.5 Preview | implemented for generation | no edit/extend | yes | no public xAI REST audio input found | yes, model behavior | prompt-compiled dialogue/audio instructions | no | no | I2V/Ref2V continuity via frame anchors and refs |
| Seedance 2.0 family | future adapter | yes, public docs describe video refs | yes | yes, Seedance 2.0 series only in BytePlus docs | yes | true audio/dialogue/reference-capable ontology target | described publicly as edit/extend capable | described publicly as continuation capable | role-bearing multimodal references: image/video/audio/sample task |
| Runway | future adapter | yes | yes | via separate audio/TTS/lip-sync/dubbing surfaces | depends on task | TTS, speech-to-speech, dubbing, lip-sync, avatar workflow | yes | model/tool-dependent | split video generation from speech/lip-sync tools |
| Higgsfield | future/reference | yes via platform/MCP | yes | platform/tool-dependent | platform/tool-dependent | Soul/Marketing/asset-management workflow concepts | model/tool-dependent | model/tool-dependent | asset browser + character training + iterative references |
| ComfyUI community workflows | reference only | yes via nodes | yes | yes via workflow | workflow-dependent | explicit node graph for audio/sync | workflow-dependent | workflow-dependent | graph-like role assignment and quality gates |

## Core Ontology

### ContinuityJob

`ContinuityJob` is the top-level long-running workflow request.

Required fields:

- `id`: server-generated request or job id.
- `prompt`: root creative intent.
- `durationSeconds`: total target duration.
- `clipDurationSeconds`: per-segment duration.
- `resolution`: provider-supported resolution.
- `aspectRatio`: provider-supported aspect ratio.
- `provider`: initial provider family.
- `model`: provider model.
- `strategy`: continuity strategy.
- `assets`: role-bearing references.
- `audio`: structured audio/dialogue guidance.
- `segments`: generated or planned clip segments.
- `qualityGate`: optional validation policy.

Initial strategy values:

- `last-frame-i2v`
- `first-last-frame`
- `ref2v-continuity`
- `provider-native-v2v`
- `provider-native-extend`

Initial invariant:

- `durationSeconds` must be a positive integer.
- `clipDurationSeconds` must be a positive integer.
- `durationSeconds / clipDurationSeconds` determines maximum segment count.
- Provider adapters may clamp or reject unsupported values.
- For Grok 1.5 continuity, `strategy` must not require edit/extend.

### ClipSegment

`ClipSegment` represents one generated unit inside a continuity job.

Fields:

- `index`: 1-based segment number.
- `prompt`: segment prompt after compilation.
- `sourcePrompt`: user/root prompt before compilation.
- `inputAnchors`: frame or asset anchors used to generate this segment.
- `filename`: generated artifact filename when available.
- `url`: local generated URL when available.
- `durationSeconds`
- `resolution`
- `aspectRatio`
- `model`
- `status`: `queued`, `running`, `complete`, `failed`, `skipped`.
- `analysis`: optional first/last frame or quality analysis.

Invariant:

- A segment cannot be `complete` without an artifact filename.
- A segment after index 1 must declare how continuity was anchored.

### AssetRef

`AssetRef` is a role-bearing reference item.

Fields:

- `id`: optional persistent asset id.
- `alias`: optional user-facing alias such as `@bocchi`, `@rooftop`, `@audio1`.
- `role`: semantic role.
- `kind`: physical modality.
- `source`: local path, generated filename, data URL, remote URL, or future asset id.
- `weight`: optional adapter hint.
- `notes`: optional human-readable constraints.

Initial `role` values:

- `person`
- `character`
- `scene`
- `style`
- `motion`
- `camera`
- `audio`
- `voice`
- `music`
- `dialogue`
- `firstFrame`
- `lastFrame`
- `targetEndFrame`
- `negative`

Initial `kind` values:

- `image`
- `video`
- `audio`
- `text`
- `generated`
- `frame`
- `sampleTask`

Invariant:

- `@` aliases resolve before provider adapter compilation.
- Alias resolution must not silently pick unrelated history items.
- Provider adapters must either map, prompt-compile, or reject unsupported roles.
- Unsupported roles must be explicit in the result, not silently ignored.

### DialogueSpec

`DialogueSpec` models spoken words, voice, timing, and lip-sync intent separately from the visual prompt.

Fields:

- `id`
- `speaker`: speaker alias or role.
- `text`: exact dialogue.
- `language`: BCP-47-like language tag when known.
- `voice`: optional voice description or provider voice id.
- `timing`: optional `{ startSeconds, endSeconds }`.
- `delivery`: performance direction.
- `lipSync`: `none`, `prompt-only`, `provider-native`, `post-process`.
- `visibility`: whether subtitles/visible text are allowed.

Initial invariant:

- Dialogue text must be preserved verbatim during prompt compilation.
- For Grok, `DialogueSpec` is prompt-compiled and must include an explicit no-subtitle/no-visible-text instruction when `visibility` forbids text.
- For Runway-like adapters, `DialogueSpec` may map to TTS/lip-sync/dubbing tasks.
- For Seedance-like adapters, `DialogueSpec` may map to text plus audio/reference fields when supported.

### AudioSpec

`AudioSpec` models non-dialogue sound.

Fields:

- `music`: optional music direction.
- `ambience`: optional environmental sound.
- `soundEffects`: list of sound effect directions.
- `audioRefs`: list of `AssetRef` ids or aliases.
- `syncPolicy`: `prompt-only`, `reference-guided`, `provider-native`, `post-process`.

Invariant:

- Grok adapter compiles `AudioSpec` into prompt text.
- Future Seedance adapters may pass audio refs directly.
- Future Runway adapters may generate sound effects or speech in side tasks.

### FrameAnchor

`FrameAnchor` is a visual continuity anchor extracted from a segment or supplied by the user.

Fields:

- `role`: `first`, `last`, `targetEnd`, `keyframe`, `negative`.
- `source`: generated filename, local path, remote URL, or data URL.
- `timestampSeconds`: optional numeric timestamp.
- `imagePath`: local extracted image path when available.
- `description`: optional visual analysis.
- `strictness`: `soft`, `normal`, `strict`.

Invariant:

- `last` anchors for generated videos must be extractable without browser-only APIs.
- Frame extraction failures must be surfaced as workflow errors with the source filename.
- A `targetEnd` anchor is a goal reference, not a guarantee unless the provider supports first-last-frame generation.

## API Schema Draft

Endpoint:

```text
POST /api/video/continuity
```

Draft request:

```json
{
  "prompt": "emotional rooftop guitarist",
  "durationSeconds": 60,
  "clipDurationSeconds": 10,
  "resolution": "720p",
  "aspectRatio": "16:9",
  "provider": "grok",
  "model": "grok-imagine-video-1.5-preview",
  "strategy": "last-frame-i2v",
  "assets": [
    { "alias": "@bocchi", "role": "person", "kind": "image", "source": "bocchi-face.png" },
    { "alias": "@rooftop", "role": "scene", "kind": "image", "source": "rooftop-style.png" }
  ],
  "audio": {
    "music": "quiet guitar melody",
    "ambience": "dawn city after rain",
    "soundEffects": ["wind", "distant train"],
    "syncPolicy": "prompt-only"
  },
  "dialogue": [
    {
      "speaker": "@bocchi",
      "text": "I can do this.",
      "language": "en",
      "delivery": "barely whispered, nervous but hopeful",
      "lipSync": "prompt-only",
      "visibility": "no-subtitles"
    }
  ],
  "qualityGate": {
    "maxRegenerations": 1,
    "checks": ["character", "scene", "no-visible-text", "audio-intent"]
  }
}
```

Draft response:

```json
{
  "jobId": "vc_...",
  "status": "complete",
  "filename": "final.mp4",
  "url": "/generated/final.mp4",
  "durationSeconds": 60,
  "segments": [
    {
      "index": 1,
      "filename": "clip_01.mp4",
      "durationSeconds": 10,
      "anchors": []
    }
  ],
  "warnings": [
    "grok adapter compiled audio/dialogue into prompt; no true audio reference input was sent"
  ]
}
```

## CLI Schema Draft

Command:

```bash
ima2 video continuity "emotional rooftop guitarist" \
  --duration 60 \
  --clip-duration 10 \
  --resolution 720p \
  --aspect-ratio 16:9 \
  --model grok-imagine-video-1.5-preview \
  --strategy last-frame-i2v \
  --person @bocchi \
  --scene @rooftop \
  --music "quiet guitar melody" \
  --ambience "dawn city after rain" \
  --dialogue '@bocchi|en|I can do this.|barely whispered, nervous but hopeful' \
  --max-regenerations 1 \
  -o final.mp4
```

Alias support:

```bash
ima2 video asset set @bocchi --role person --kind image --file face.png
ima2 video asset set @rooftop --role scene --kind image --file rooftop.png
ima2 video asset ls
```

The asset commands are not required in the first implementation if aliases can resolve from inline file paths, but the schema should not block them.

## Skill Update Plan

Update `skills/ima2/SKILL.md` with:

1. Provider capability matrix.
2. Grok audio/dialogue output guidance.
3. Explicit note: Grok has no confirmed public REST audio input parameter in current xAI video generation/edit/extension examples.
4. Seedance-style role-bearing reference examples.
5. Runway-style dialogue/lip-sync distinction.
6. `@person` / `@scene` / `@audio` alias concept.
7. Continuity workflow guidance:
   - last-frame I2V
   - first-last-frame when provider supports it
   - native V2V/edit/extend when provider supports it
8. Warning that shot sequences are not the same as continuity editing.

## Success Criteria For This Spec Pack

Completed in this document:

- `ContinuityJob` defined.
- `AssetRef` defined.
- `DialogueSpec` defined.
- `FrameAnchor` defined.
- Provider capability matrix defined.
- Draft API schema defined.
- Draft CLI schema defined.
- Skill update plan defined.

Still needs interview confirmation:

- first implementation scope
- alias persistence model
- live smoke length
- quality gate strictness
- whether external providers remain design references or become integration targets
