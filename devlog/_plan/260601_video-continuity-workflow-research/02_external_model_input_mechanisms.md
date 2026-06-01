# External Video Model Input Mechanisms

Date: 2026-06-01

## Purpose

Jun requested external/community reverse-analysis and a broader survey of major video generation models before deciding the ima2 continuity workflow design.

This document separates:

- official API/product documentation
- third-party API wrappers
- community observations
- speculative or low-trust claims

The goal is not to integrate these providers now. The goal is to shape ima2's provider-agnostic continuity ontology.

## Trust Levels

| Level | Meaning |
|---|---|
| A | official provider docs, official product docs, official technical report |
| B | established third-party API wrapper docs |
| C | community workflow reports, Reddit, forum posts, tutorials |
| D | marketing-only pages, SEO clones, unclear ownership, possible scam pages |

## Cross-Provider Pattern

The stronger video systems do not treat continuity as "append clips together".

They expose or simulate role-bearing inputs:

- text instruction
- prompt image / source image
- reference images
- reference video
- first frame
- last frame / end frame
- motion reference
- audio reference
- dialogue / TTS
- lip-sync over existing video
- task id / previous generation reuse
- asset browser / history reuse

ima2 should therefore model references as typed `AssetRef` records and let adapters map them to provider-specific mechanisms.

## Model / Provider Matrix

| Model / Provider | Source level | Text | Image input | Multi-image / character refs | Video input | Audio input | Native audio output | Dialogue / lip-sync | First/last frame | Extend/edit | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Grok Imagine Video | A/B | yes | yes | yes, ref images | edit/extend base only | no public REST audio input found | yes | prompt-compiled | via ima2 frame workflow | base model edit/extend | Good first adapter; audio/dialogue must compile into prompt |
| Grok Imagine Video 1.5 Preview | A/B | through ima2 canvas fallback for T2V | yes | yes | no edit/extend | no public REST audio input found | yes | prompt-compiled | via ima2 frame workflow | no | Best used as I2V/Ref2V continuity generator |
| Seedance 2.0 | A/B | yes | yes | yes | yes, video refs | yes, Seedance 2.0 series only in BytePlus docs | yes | audio-video joint generation | FLF2V in ComfyUI docs | edit/extend described publicly | Strong model for role-bearing multimodal ontology |
| Runway Gen-4.5 | A | yes | yes | image as composition/style anchor | video-to-video via separate API surfaces, not Gen-4.5 I2V guide | separate sound/TTS/lip-sync/dubbing surfaces | tool-dependent | separate workflows | last-frame chaining recommended in help docs | API has multiple task types | Runway is tool-suite style, not one monolithic endpoint |
| Kling 2.6 / 3.0 / O1 / O3 4K / Omni family | A/B/C | yes | yes | yes, O3 wrapper docs expose element lists and image references | yes in O3 video edit, Omni, lip-sync, and extend wrappers | lip-sync accepts audio; O3 wrappers expose generated sound; newer models claim native audio | yes in 2.6+/O3 wrapper material | separate lip-sync and/or unified Omni | O3 wrappers expose start/end frame | extend/lip-sync/video-edit endpoints in third-party docs | Strong evidence for separating generation vs lip-sync adapter and modeling high-res provider constraints |
| MiniMax / Hailuo | B/C | yes | yes | some API wrappers expose image mode | unclear / model-dependent | separate audio/TTS products exist | model-dependent | separate audio products likely | unclear | model-dependent | Needs more official API docs; community reports are weaker |
| HappyHorse 1.0 | C/D | yes | yes | claimed | claimed | claimed | claimed joint audio-video | claimed multilingual lip-sync | claimed | claimed | Highly noisy: several SEO-like pages and Reddit warnings. Treat as research-only until official source is identified |
| ComfyUI community workflows | C | yes | yes | yes via nodes/IPAdapter/etc. | yes via nodes | yes via nodes | workflow-dependent | via lip-sync nodes | yes | workflow-dependent | Valuable for workflow design, not provider claims |

## Runway

Sources:

- https://docs.dev.runwayml.com/api/
- https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5
- https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide
- https://help.runwayml.com/hc/en-us/articles/31941427186323-Creating-with-Lip-Sync

Findings:

- Runway API exposes multiple task families, not one single continuity endpoint.
- API references include image-to-video, text-to-video, video-to-video, character control, sound effects, text-to-speech, speech-to-speech, dubbing, avatar video, and workflows.
- Gen-4.5 help currently describes Text to Video and Image to Video controls, with more inputs coming later.
- Runway Image-to-Video guide says the image defines composition, subject matter, lighting, and style; prompt describes motion, camera work, and temporal progression.
- Runway explicitly recommends creating longer sequences by extracting the last frame of a completed generation and using it as image input for a new video.
- Runway Lip Sync treats spoken output as a separate workflow: select face, provide uploaded audio or TTS, sync lips to the audio.

Implication for ima2:

- Do not collapse audio/dialogue into the video prompt concept.
- Model `DialogueSpec` separately so a Runway adapter can route it to TTS/lip-sync/dubbing tasks.
- Keep `FrameAnchor.last` as a first-class continuity mechanism because Runway officially teaches that workflow.

## Seedance 2.0

Sources:

- https://seed.bytedance.com/en/seedance2_0
- https://seed.bytedance.com/en/blog/seedance-2-0-official-launch
- https://arxiv.org/abs/2604.14148
- https://docs.comfy.org/tutorials/partner-nodes/bytedance/seedance-2-0
- https://docs.byteplus.com/en/docs/ModelArk/1520757
- https://www.seedvideo.net/docs/seedance-2-parameters

Findings:

- Official/technical sources describe Seedance 2.0 as multimodal audio-video generation.
- Public input references include text, image, audio, video, and sample task id in BytePlus docs.
- BytePlus specifically notes audio input is available for Seedance 2.0 series.
- ComfyUI exposes T2V, R2V, and FLF2V workflows.
- FLF2V is important for ima2 because it models first and last frame anchors directly.
- R2V can use reference image/video/audio to guide look, motion, and rhythm.
- Public docs do not prove a pure `video -> text -> LLM text -> video` internal architecture.

Implication for ima2:

- Model audio reference input even if Grok cannot use it now.
- Model `FrameAnchor.targetEnd` because first-last-frame generation is a distinct workflow.
- Model `sampleTask` or previous generation task reference as a future `AssetRef.kind`.

## Kling

Sources:

- https://kling.ai/quickstart/ai-lip-sync-guide
- https://kling.ai/document-api/apiReference%2Fmodel%2FvideoModels
- https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide
- https://klingapi.com/docs
- https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-lipsync
- https://artlist.io/ai/models/kling-o3
- https://wavespeed.ai/blog/posts/introducing-kwaivgi-kling-video-o3-4k-image-to-video-on-wavespeedai/
- https://wavespeed.ai/blog/posts/introducing-kwaivgi-kling-video-o3-4k-text-to-video-on-wavespeedai/
- https://arxiv.org/abs/2603.03160
- https://arxiv.org/abs/2512.16776
- https://ir.kuaishou.com/node/11111/pdf

Findings:

- Kling O3 4K exists in external model catalogs and wrapper docs. It is described as a Kuaishou/Kling model with text-to-video, image-to-video, video-to-video/editing, and up-to-4K output.
- Artlist's Kling O3 page describes text prompts, images, video uploads, character images, start/end frames, video-to-video editing, targeted video editing, multi-shot continuity, 3-15 second durations, and 4K output.
- WaveSpeed's Kling O3 4K Image-to-Video wrapper describes `image + prompt` as required inputs and optional `end_image`, `duration` 3-15 seconds, `sound`, `shot_type`, `multi_prompt`, and `element_list`.
- WaveSpeed positions O3 4K as a native/high-resolution 4K model rather than a simple upscaler, but this is wrapper-level evidence, not official Kuaishou API contract evidence.
- Official Kling UI docs describe lip-sync as a separate paid feature: generate a character video, then upload local voice/singing audio or use TTS.
- Lip-sync supports generated Kling videos with a complete human face; audio can be cropped if longer than the video.
- Third-party API docs expose text2video, image2video, extend, and lip-sync endpoints.
- fal Kling lipsync API models audio-to-video as `video_url + audio_url`.
- Kling 2.6 launch material claims simultaneous audio-visual generation for text-to-audio-visual and image-to-audio-visual.
- Kling 3.0 Omni public material describes more unified multimodal input/output.
- Kling-MotionControl technical report frames character animation as transferring motion dynamics from a driving video to a reference image.
- Kling-Omni technical report claims a unified multimodal representation across text instructions, reference images, and video contexts.

Community notes:

- Reddit users report lip-sync is practically a separate workflow and can reject/struggle with uploaded audio.
- Community reports say lip-sync quality can drift or degrade after edit/lip-sync passes.
- Some reports recommend generating clean face-visible video first, then applying lip-sync.

Implication for ima2:

- `DialogueSpec.lipSync` must not be a boolean. It needs modes: `prompt-only`, `provider-native`, `post-process`.
- `AudioSpec` must support uploaded audio refs separately from prompt music/sound guidance.
- `FrameAnchor` must support both `first` and `last/targetEnd` because O3 wrapper docs expose start/end-frame style control.
- `AssetRef` needs named reusable elements, not only anonymous files, because O3 wrapper docs expose element lists for character/object/style consistency.
- `ContinuityJob.output` needs resolution tiers and provider caps because O3-style models expose 4K while Grok currently caps lower.
- Quality gates should include face visibility when lip-sync is requested.

## MiniMax / Hailuo

Sources:

- https://unifically.com/blogs/minimax
- https://www.reddit.com/r/HailuoAiOfficial/comments/1gw2odl
- https://www1.smartlab.gov.hk/image-file/smartlab/prod/assets/ai_solutions/20250619171621382410_Intro%20of%20MiniMax-One%20Pager-1.pdf

Findings:

- Public wrapper material describes MiniMax/Hailuo video models with text and image modes.
- Some wrappers expose auto-routing text or image and task-based APIs.
- MiniMax has separate audio/TTS/music product lines, but this research pass did not find enough official Hailuo video API detail to model native audio/video continuity confidently.
- Community reports suggest image reference behavior exists but may be model/API-specific.

Implication for ima2:

- Keep MiniMax/Hailuo as a future provider family, but do not design the first ontology around unverified Hailuo-specific features.

## HappyHorse

Sources:

- https://www.happyhorses.ai/
- https://happy-horses.io/
- https://happy-horse.ai/docs
- https://happyhorse.app/docs
- https://www.reddit.com/r/generativeAI/comments/1sx7i6h
- https://www.reddit.com/r/StableDiffusion/comments/1shi6ca

Findings:

- Multiple HappyHorse-branded sites claim multimodal input: text, image, video, audio.
- Claims include 9 images, 3 videos, 3 audio files, joint audio-video generation, multilingual lip-sync, and strong character consistency.
- The web surface is noisy: multiple similar domains, SEO-like pages, and Reddit warnings about fake/scam sites.
- At least some community posts say the model appears on third-party platforms, but source authenticity remains unclear.

Implication for ima2:

- Treat HappyHorse as a low-trust reference source until an official provider/API identity is confirmed.
- Do not let HappyHorse drive core ontology decisions beyond reinforcing the same generic multimodal reference pattern.

## Community / Reverse-Analysis Patterns

Common patterns across Reddit, ComfyUI workflows, and third-party docs:

1. Last-frame chaining is common, but insufficient alone.
2. First-last-frame workflows are a stronger continuity primitive when the provider supports it.
3. Character consistency often needs identity references separate from motion/camera references.
4. Lip-sync is frequently post-process or side-task, not part of base video generation.
5. Native audio-video generation exists in newer models, but controllability still varies.
6. Audio references can be ignored, overpowered, cropped, rejected, or desynchronized.
7. A good workflow needs quality gates:
   - face visible for lip-sync
   - no unwanted visible subtitles
   - character consistency
   - scene continuity
   - audio/dialogue intent preserved
   - duration and aspect constraints preserved

## Design Consequence For ima2

ima2 should not model continuity as one provider feature.

It should model continuity as a provider-adapted workflow:

```text
ContinuityJob
  -> AssetRef[]
  -> DialogueSpec[]
  -> AudioSpec
  -> FrameAnchor[]
  -> ProviderCapability
  -> ProviderAdapter.compile()
  -> SegmentGeneration[]
  -> QualityGate
  -> FinalAssembly
```

Provider adapters decide whether a field is:

- directly passed to the provider,
- compiled into prompt text,
- handled by a side task,
- rejected as unsupported,
- ignored only if explicitly marked optional.

## Open Interview Questions

- Which providers are trusted enough to appear in the first public matrix?
- Should HappyHorse be included as low-trust research only, or omitted until verified?
- Should first implementation support only Grok adapter, or define provider adapter interfaces first?
- Should quality gates be required in MVP or only logged as warnings?
