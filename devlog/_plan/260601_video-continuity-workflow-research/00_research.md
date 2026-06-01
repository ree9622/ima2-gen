# Video Continuity Workflow Research

Date: 2026-06-01

## User Problem

Jun clarified that the target is not a generator that stitches several 10-second clips. The target is a video workflow engine capable of continuity editing.

Required controls:

- explicit seconds / duration control
- resolution control
- aspect-ratio control
- continuity editing, not just shot sequencing
- first-class dialogue / speech / voice / sound guidance in the skill and prompt contract
- `@person` / `@asset` reference syntax
- research Runway, Higgsfield, Seedance 2.0, and community workflows before implementation

## Current ima2 Gap

Current ima2 has:

- `ima2 video` T2V/I2V/Ref2V
- `ima2 video frame`
- `ima2 video analyze`
- `ima2 video edit`
- `ima2 video extend`
- prompt-level audio guidance in `skills/ima2/SKILL.md`

Current ima2 does not yet have:

- continuity workflow job/entity
- `@person` / `@asset` resolver
- structured dialogue/audio spec
- continuity quality gate
- provider-agnostic reference ontology
- first/last-frame workflow command
- long-form continuity automation

## Seedance 2.0 Public Evidence

Primary sources checked:

- https://seed.bytedance.com/en/seedance2_0
- https://seed.bytedance.com/en/blog/seedance-2-0-official-launch
- https://arxiv.org/abs/2604.14148
- https://docs.comfy.org/tutorials/partner-nodes/bytedance/seedance-2-0
- https://www.seedvideo.net/docs/seedance-2-manual
- https://docs.byteplus.com/en/docs/ModelArk/1520757

Public claims consistently describe Seedance 2.0 as a unified multimodal audio-video joint generation model.

Important public facts:

- Inputs: text, image, audio, video.
- Output: audio-video generation, 4-15 seconds in the arXiv abstract.
- Open platform limits from arXiv abstract: up to 3 video clips, 9 images, and 3 audio clips as references.
- ByteDance official blog says it can reference visual composition, camera language, motion rhythm, and sound characteristics from input assets.
- ByteDance official blog says editing and extension are supported, including targeted modifications and video continuation.
- ComfyUI Seedance 2.0 docs expose workflows: T2V, R2V, FLF2V.
- ComfyUI docs describe R2V as using reference images, video, or audio to guide look, motion, and rhythm.
- ComfyUI docs describe FLF2V as providing a starting frame and ending frame so Seedance generates motion and transitions between them.
- Seedance manual examples use `@image1`, `@video1`, `@audio1` role assignment.
- BytePlus ModelArk documentation says references support text, image, audio, video, and sample task ID, and explicitly notes that only the Seedance 2.0 series supports audio input.

## On Jun's Hypothesis: v -> t -> LLMt -> v

Jun hypothesized that Seedance 2.0 may not be true internal V2V and may work like video-to-text, LLM text transformation, then video generation.

Public evidence does not prove that hypothesis.

What public evidence supports:

- Seedance 2.0 is described as unified multimodal audio-video joint generation.
- It accepts video references directly, not merely text summaries.
- It can reference camera language, motion rhythm, visual composition, and sound characteristics from assets.
- The paper abstract says four modalities are integrated into a comprehensive suite of multimodal reference and editing capabilities.

What remains unknown:

- Exact proprietary internal architecture for editing/extension is not fully disclosed.
- It may use internal captioning/planning stages, but public sources do not reduce it to only `video -> text -> LLM text -> video`.
- A more precise claim would be: Seedance likely uses multimodal encoders and planning/instruction-following layers before diffusion/DiT generation. Public docs frame video input as a reference modality, not as a text-only intermediate.

## Grok Imagine Audio Input vs Audio Output

Primary sources checked:

- https://docs.x.ai/docs/guides/video-generations
- https://docs.x.ai/developers/model-capabilities/video
- https://x.ai/api/imagine
- https://developers.cloudflare.com/ai/models/xai/grok-imagine-video/
- https://runware.ai/docs/models/xai-grok-imagine-video

Current public xAI REST video examples expose text/image/video inputs depending on endpoint:

- `/v1/videos/generations`: prompt, image/reference-image style inputs.
- `/v1/videos/edits`: prompt + input video.
- `/v1/videos/extensions`: prompt + input video.

No official xAI REST parameter for user-supplied audio input was found in the checked generation/edit/extension examples.

Public wrapper/model pages consistently claim Grok Imagine Video outputs native synchronized audio, including dialogue, sound effects, music, and ambience. This should be represented in ima2 as a first-class prompt/output capability, not as an afterthought. But as of this research pass, Grok should be treated as:

- audio output: supported by model behavior / prompt guidance
- audio input/reference: not exposed in current official xAI REST surface found

Workflow implication:

- Grok adapter should accept structured `audio` / `dialogue` fields and compile them into prompt instructions.
- A future Seedance/Runway/Higgsfield adapter may map the same ontology to true audio reference inputs, TTS, lip-sync, or voice dubbing fields.

## External / Community Analysis Notes

Public external analysis and community reports reinforce the same distinction:

- Seedance 2.0 is repeatedly described as unified multimodal input, not merely silent video generation plus later audio.
- Community workflow guides emphasize focused role assignment: one reference for identity, one for motion/camera, one for rhythm/audio, rather than dumping every asset into one prompt.
- Community reports also warn that Seedance 2.0 audio reference adherence is imperfect; audio references may be ignored or overpowered by background noise. Therefore ima2 should model audio references as guidance with confidence/quality gates, not guaranteed control.
- Grok community discussions describe native audio and dialogue as useful but not perfectly controllable; dialogue can leak into visible subtitles/text unless prompts explicitly forbid visible text.

Resulting practical rule for ima2:

```text
Dialogue/audio are first-class workflow fields.
Provider adapters decide whether they are:
1. prompt-compiled only,
2. generated by a TTS/lip-sync side workflow,
3. passed as real audio references,
4. unsupported and rejected.
```

## Workflow Implications for ima2

The relevant idea to copy is not "V2V endpoint" alone.

The useful ontology is:

- `ContinuityJob`
- `ClipSegment`
- `AssetRef`
- `CharacterRef`
- `SceneRef`
- `MotionRef`
- `AudioRef`
- `DialogueSpec`
- `FrameAnchor` (`first`, `last`, `targetEnd`)
- `ContinuityPrompt`
- `QualityGate`

A future ima2 workflow should allow prompts like:

```text
@person defines the character identity.
@scene defines location and palette.
@video1 defines camera movement and rhythm.
@audio1 defines music pacing and emotional arc.
@frame:last is the required opening continuity anchor.
Generate 10s, 720p, 16:9, continue without hard cut.
Dialogue: "..."
Sound: rain, room tone, guitar resonance.
```

## Candidate ima2 Feature Shape

Possible command:

```bash
ima2 video continuity "emotional rooftop guitarist" \
  --duration 120 \
  --clip-duration 10 \
  --resolution 720p \
  --aspect-ratio 16:9 \
  --person @bocchi \
  --scene @rooftop \
  --audio "quiet guitar, city ambience" \
  --dialogue "..." \
  --model grok-imagine-video-1.5-preview \
  --strategy first-last-frame-i2v \
  --out final.mp4
```

Possible API:

```text
POST /api/video/continuity
```

Possible request shape:

```json
{
  "prompt": "emotional rooftop guitarist",
  "duration": 120,
  "clipDuration": 10,
  "resolution": "720p",
  "aspectRatio": "16:9",
  "model": "grok-imagine-video-1.5-preview",
  "strategy": "first-last-frame-i2v",
  "references": [
    { "role": "person", "alias": "@bocchi" },
    { "role": "scene", "alias": "@rooftop" },
    { "role": "lastFrame", "source": "previousClip" }
  ],
  "audio": {
    "music": "quiet guitar",
    "ambience": "dawn city after rain",
    "dialogue": []
  }
}
```

## Open Questions For Interview

- Should the first implementation be Grok-only or provider-agnostic with Grok adapter first?
- Should `@person` resolve to file aliases, generated history assets, or full character profiles?
- Should dialogue/audio be structured prompt-only for Grok, or should the ontology already support providers with true TTS/lip-sync/audio inputs?
- What is the minimum success test: docs only, CLI MVP, server API MVP, live 60s smoke, or full 120s smoke?
