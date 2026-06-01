# 11 Lineage Stack Implementation Plan

Date: 2026-06-01

## Scope Decision

This phase implements the video continuation workflow engine surface that was
confirmed after the initial spec pack. It replaces the earlier topic-only
continuity plan with branch-local, artifact-persisted continuity lineage.

In scope:

- Branch-local video `revisedPrompt` lineage stack.
- `ima2 video continue "<prompt>" --video <file>` CLI command.
- Classic `Continue here`, gallery video drag, Node parent-video generation,
  and CLI continuation using the same lineage semantics.
- Active video prompt guardrails: blank prompts are blocked; weak prompts are
  allowed but CLI/API/UI/skill must show a structured active video prompt
  template.
- Grok 4.3 video planner prompt receives numbered lineage ids.
- All Grok 4.3 prompt surfaces are inventoried in
  `structure/01-file-function-map.md` under a dedicated "Grok 4.3 prompt
  surfaces" table:
  - `lib/grokImageAdapter.ts`
  - `lib/grokVideoAdapter.ts`
  - `routes/videoExtended.ts`
  - `lib/agentRuntime.ts` as a caller/delegator note, not a prompt owner.
- Non-Grok planner surfaces such as `lib/cardNewsPlannerPrompt.ts` are
  documented separately so the inventory does not falsely treat them as Grok
  4.3 surfaces.
- UI displays continuation lineage metadata on the right-side video surface.
- Skill/docs describe video prompt structure, continuation, edit, extension,
  CLI surfaces, and limits.
- Structure/docs baseline is brought forward from the older "video
  planning-only / image-only" snapshot to the current shipped video runtime.

Out of scope:

- General image-to-video prompt rewriting changes when the user is not in a
  video continuation workflow.
- New external provider integrations.
- Live paid 120s generation as a required automated test.
- Hard semantic blocking of "weak" video prompts. Only blank/whitespace prompt
  is blocked.

## Required User Decisions

Confirmed:

- Planner input uses `revisedPrompt` as the primary continuity text.
- Metadata also stores `userPrompt`.
- CLI command shape is `ima2 video continue "<next action>" --video <file>`.
- Blank prompt is hard-blocked.
- Weak prompt is not hard-blocked; guidance is shown instead.
- Existing automatic `animateImage` fallback prompt must be removed.
- Lineage stack keeps a maximum of four entries using `keep-start-plus-latest-3`.

## Current Code Facts

- `routes/video.ts` already stores `prompt`, `userPrompt`, `revisedPrompt`,
  requested/effective model metadata, and `videoSeries`.
- `lib/videoSeriesChain.ts` is topic-based and scans generated sidecars. It is
  not branch-local and must not be the source of truth for the new lineage stack.
- `ui/src/components/ResultActions.tsx` extracts the last frame for video
  `Continue here`, but only stores a reference image and optionally restores the
  topic.
- `ui/src/components/PromptComposer.tsx` handles gallery video drag by
  extracting the last frame and adding it as a reference image only.
- `ui/src/components/GalleryImageTile.tsx` and
  `ui/src/components/HistoryStrip.tsx` are the internal drag producers. They
  currently serialize only `{ image, filename }`, so the drop target cannot
  recover lineage metadata unless the producer payload is expanded.
- Node mode extracts a parent video last frame in `ui/src/store/useAppStore.ts`,
  but does not carry parent prompt lineage metadata.
- `bin/commands/video.ts` blocks blank prompts but only says `prompt is
  required`.
- `ui/src/store/useAppStore.ts` currently has a weak fallback prompt in
  `animateImage`: `Animate this image with subtle, natural motion.`
- `lib/grokVideoAdapter.ts` is already 496 lines; new continuity logic must be
  split into focused helper modules.
- `structure/*` is stale for video: `00-structure-hub.md`,
  `03-server-api.md`, and related docs still include "planning-only/no-video"
  wording from earlier releases. This must be corrected in the same phase so
  skill/docs and implementation do not drift again.
- `structure/06-infra-operations.md` also has stale "image-only release
  scope" wording and must be corrected in the same structure pass.

## Target Ontology

### VideoContinuityLineage

Stored on generated video sidecars and returned through history/API/UI.

```ts
type VideoContinuityLineage = {
  lineageId: string;
  parentFilename: string | null;
  sourceFrame: "last" | null;
  maxEntries: 4;
  retention: "keep-start-plus-latest-3";
  entries: VideoContinuityEntry[];
};
```

### VideoContinuityEntry

```ts
type VideoContinuityEntry = {
  id: string;
  ordinal: number;
  role: "start" | "ancestor" | "parent" | "current";
  filename: string | null;
  userPrompt: string | null;
  revisedPrompt: string;
  createdAt: number;
};
```

### Retention Rule

If the parent lineage plus current entry exceeds four entries, keep the first
entry and the latest three entries.

Example:

```text
[1, 2, 3, 4] + 5 => [1, 3, 4, 5]
```

### Planner Input

The Grok 4.3 planner receives a compact, numbered lineage section before the
user's new request:

```text
[Continuity lineage: branch-local, max 4 entries, start anchor preserved]
1. Clip 1 / start
   file: ...
   revisedPrompt: ...
2. Clip 3 / parent
   file: ...
   revisedPrompt: ...

Continue from the final frame and final action/audio state of the latest
lineage item. Do not restart the scene.
```

## File-Level Plan

### New Files

#### `lib/videoContinuity.ts`

Owns server-side lineage types and pure helpers:

- `ACTIVE_VIDEO_PROMPT_GUIDANCE`
- `requireActiveVideoPrompt(value)`
- `readVideoSidecar(generatedDir, filename)`
- `safeGeneratedVideoFilename(value)`
- `buildVideoContinuityLineage(options)`
- `formatVideoContinuityForPlanner(lineage)`
- `trimLineageEntries(entries)`
- `resolveAuthoritativeLineage(options)`

Trust model:

- If `continueFromVideo` is present, the server reads the generated video
  sidecar and rebuilds the parent lineage from disk. Client-provided
  `continuityLineage` is treated as a UI hint only and never overrides the
  sidecar.
- If `continueFromVideo` is absent but `continuityLineage` is present, the
  server accepts the client lineage as a continuation hint after shape
  validation.
- If both `topic` and explicit lineage are present, explicit lineage is the
  primary planner context and topic remains legacy/best-effort context.

#### `lib/videoFrameExtract.ts`

Owns reusable server-side frame extraction so CLI continuation does not depend
on browser canvas APIs:

- validate generated `.mp4` filenames before reading.
- extract the last frame of a generated video to a temporary PNG using ffmpeg.
- return base64/png data suitable for the existing I2V `sourceImage` path.
- share implementation with `/api/video/frame` where practical so route
  behavior stays consistent.

This keeps `routes/video.ts` and `lib/grokVideoAdapter.ts` below the complexity
threshold.

#### `ui/src/lib/videoContinuity.ts`

Owns client-side lineage types and helpers:

- `VideoContinuityLineage`
- `VideoContinuityEntry`
- `ACTIVE_VIDEO_PROMPT_GUIDANCE`
- `activeVideoPromptMessage`
- `buildContinuityPromptChip(lineage)`
- `trimLineageEntries(entries)`
- `continuitySummary(lineage)`

The UI helper mirrors server semantics without importing server code.

#### `tests/videoContinuity.test.ts`

Pure tests for retention and planner formatting.

#### `tests/video-continuity-ui-contract.test.js`

Source-contract tests for UI prompt guardrails, continuation display, and
fallback-prompt removal.

### Modified Files

#### `lib/grokVideoAdapter.ts`

- Extend `generateVideoViaGrok` options to accept optional
  `continuityLineage`.
- Extend `planGrokVideo` and the internal planner payload options with the
  same `continuityLineage` field so the data is threaded all the way to
  `buildGrokVideoPlannerPayload`.
- Pass formatted lineage text into `buildGrokVideoPlannerPayload`.
- Strengthen planner instructions so lineage means continuation, not restart.
- Keep new code minimal because this file is near the 500-line limit.

#### `lib/capabilities.ts`

- Replace topic-only video guidance with active video prompt requirements.
- Mention `ima2 video continue "<prompt>" --video <file>` as the preferred
  branch-local continuation command.
- Keep `--topic` documented as legacy/best-effort series context, not the
  primary continuity mechanism.

#### `routes/video.ts`

- Replace inline topic-only prompt prefixing with lineage-aware prompt context.
- Accept optional `continuityLineage` and `continueFromVideo` style inputs.
- For `continueFromVideo` or `sourceFilename` pointing to a generated video,
  validate it as a generated `.mp4`, read parent sidecar, extract the last
  frame server-side, and inject that PNG as the I2V source image.
- Reject or safely route raw `.mp4` `sourceFilename` so it is never read as if
  it were an image file.
- When `continueFromVideo` and client `continuityLineage` conflict, the
  sidecar-derived server lineage wins.
- Save `videoContinuity` in sidecar.
- Return `videoContinuity` in SSE `done`.
- Use active video prompt guidance for `PROMPT_REQUIRED`.
- Keep existing `videoSeries` compatibility, but make it secondary to
  explicit lineage.

#### `routes/videoExtended.ts`

- Use active video prompt guidance for edit/extend blank prompt errors.
- Persist `videoContinuity` for native extension when source sidecar exists,
  so extension artifacts do not lose branch context.

#### `lib/historyList.ts`

- Include `videoContinuity` in history rows.

#### `ui/src/types.ts`

- Add `VideoContinuityLineage` and `videoContinuity` fields to `GenerateItem`
  and video API response types.
- Add history-visible video fields that are currently dropped in the UI:
  `mediaType`, `video`, `videoSeries`, and `videoContinuity`.

#### `ui/src/lib/api.ts`

- Add `continuityLineage`, `continueFromVideo`, and `videoContinuity` fields to
  video generate request/response types.

#### `ui/src/store/useAppStore.ts`

- Remove `animateImage` default video prompt fallback.
- If video generation is requested with blank prompt, show active video prompt
  guidance and do not generate.
- Carry `videoContinuity` through history mapping, current image, node data, and
  video generation request bodies.
- Update `mapHistoryItem` so history rows retain `mediaType`, `video`,
  `videoSeries`, `revisedPrompt`, and `videoContinuity` without `(as any)`
  recovery later.
- For Node parent-video generation, include parent video lineage and parent
  revisedPrompt context.
- Avoid adding large helper logic directly; call `ui/src/lib/videoContinuity.ts`.
- Persist a dedicated `videoContinuity` / `continuityLineage` state field so
  last-frame references and lineage prompt chips remain tied together until
  `postVideoGenerateStream`.
- Include `continuityLineage` and/or `continueFromVideo` in the video request
  body for Classic, gallery drag, and Node parent-video flows.

#### `ui/src/components/ResultActions.tsx`

- For video `Continue here`, extract last frame as today, but also attach the
  item's `videoContinuity` or create a seed lineage from the item metadata.
- Insert a stable continuation prompt chip so dedup uses lineage/source ids.
- Do not inject raw long prompt text into the main prompt field.
- Build the stable prompt chip with the same lineage id used in request
  metadata, so `insertedPrompts` id-dedup prevents duplicate lineage blocks.

#### `ui/src/components/GalleryImageTile.tsx`

- Expand the `application/ima2-ref` drag payload for video items to include
  the fields needed to seed lineage:
  - `filename`
  - `prompt`
  - `userPrompt`
  - `revisedPrompt`
  - `createdAt`
  - `videoContinuity`
- Keep image drag payload compatible with current behavior.

#### `ui/src/components/HistoryStrip.tsx`

- Apply the same expanded video drag payload as `GalleryImageTile`.
- Preserve the existing `draggable` video thumbnail behavior.

#### `ui/src/components/PromptComposer.tsx`

- For gallery video drag, attach last frame plus lineage metadata.
- Keep image drag behavior unchanged.
- Show guidance when video mode is selected and prompt is blank.
- Consume expanded producer payloads from `GalleryImageTile` and
  `HistoryStrip`; do not rely on `image`/`filename` alone.

#### `ui/src/components/VideoControlsPanel.tsx`

- Add compact continuity display:
  - source video filename
  - number of lineage entries
  - latest parent role
  - max 4 / start preserved note
- Read the pending composer continuity state for generation controls.
- Do not duplicate the selected result details owned by `Canvas`; the controls
  panel shows "what will be sent next".

#### `ui/src/components/Canvas.tsx`

- Ensure the right/result metadata surface can show `videoContinuity` when a
  video result is selected.
- Treat this as the "what was generated" result surface. It should display the
  selected video lineage entries from the history item, not the pending composer
  state.

#### `bin/commands/video.ts`

- Add `continue` subcommand:
  - `ima2 video continue "<prompt>" --video <generated-file>`
  - extracts/uses server-side continuation by sending `continueFromVideo`.
- Replace terse `prompt is required` messages with active video prompt guidance.
- Keep `edit` and `extend` prompt guards.

#### `skills/ima2/SKILL.md`

- Add the active video prompt requirement.
- Document `ima2 video continue`.
- Document branch-local lineage stack and max-4 retention.
- Replace topic-chain wording as best-effort legacy with artifact lineage as
  the preferred workflow.

#### `structure/02-command-reference.md`

- Add `ima2 video continue`.
- Update prompt guidance.

#### `structure/01-file-function-map.md`

- Add current video route/adapter/helper ownership:
  - `routes/video.ts`
  - `routes/videoExtended.ts`
  - `lib/grokVideoAdapter.ts`
  - `lib/videoSeriesChain.ts`
  - new `lib/videoContinuity.ts`
- Add the Grok 4.3 prompt surface inventory:
  - `lib/grokImageAdapter.ts`: image planner/search prompt surface; document
    only for this phase.
  - `lib/grokVideoAdapter.ts`: video planner prompt surface; modified to
    receive numbered continuity lineage.
  - `routes/videoExtended.ts`: video analysis prompt surface; document only.
  - `lib/agentRuntime.ts`: caller/delegator that can invoke video generation;
    not itself a Grok 4.3 prompt owner.
  - `lib/cardNewsPlannerPrompt.ts`: non-Grok planner prompt; separate row so it
    is not counted as Grok 4.3.

#### `structure/03-server-api.md`

- Document `videoContinuity` request/response/sidecar fields.
- Document active prompt guardrail.
- Remove stale "image-only/no-video runtime scope" wording and document the
  current video generation/edit/extend/frame/analyze routes.

#### `structure/04-frontend-architecture.md`

- Document continuation UI/reference behavior.
- Remove stale "image-only/no-video" wording where present.

#### `structure/05-node-mode.md`

- Document parent-video lineage behavior.

#### `structure/06-infra-operations.md`

- Remove stale "image-only release scope" wording from the released video
  runtime section.

#### `structure/00-structure-hub.md`

- Correct the current snapshot so video is no longer described as
  planning-only.

#### `docs/CLI.md`

- Add `ima2 video continue` and active video prompt examples.

#### `docs/API.md`

- Add `videoContinuity`, `continueFromVideo`, and active prompt guardrail
  contracts.

### Tests To Add Or Update

- `tests/videoContinuity.test.ts`
  - retention keeps first + latest 3
  - planner formatting includes numbered ids
  - blank prompt guidance is stable
- `tests/videoRoute.test.ts`
  - blank prompt returns `PROMPT_REQUIRED` with active prompt guidance
  - `continueFromVideo` extracts the parent last frame server-side instead of
    treating the mp4 as an image
  - server-side sidecar lineage wins over conflicting client lineage
  - parent video sidecar builds lineage
  - generated sidecar stores `videoContinuity`
  - SSE done includes `videoContinuity`
- `tests/videoExtendedRoute.test.ts`
  - edit/extend blank prompts return active prompt guidance
  - extension carries source lineage when source is generated video
- `tests/cli-video-command-contract.test.js`
  - help includes `continue`
  - no prompt help includes active prompt guidance
  - continue syntax is documented
- `tests/video-continuity-ui-contract.test.js`
  - `animateImage` fallback prompt removed
  - PromptComposer video drag references lineage helper
  - VideoControlsPanel displays continuity section
  - `GalleryImageTile` and `HistoryStrip` include video lineage fields in
    drag payloads
  - `postVideoGenerateStream` request can include `continuityLineage`
  - Node parent-video generation includes parent continuity metadata
- `tests/cli-skill-command-contract.test.js`
  - skill mentions active video prompt, dialogue/no-dialogue, sound flow, and
    `ima2 video continue`.
- `tests/gallery-navigation-ux-contract.test.js`
  - preserve click/delete/favorite behavior while expanding drag payload.

## Verification Plan

Local commands:

```bash
npm run typecheck
npm run typecheck:tests
node --import tsx --test tests/videoContinuity.test.ts tests/videoRoute.test.ts tests/videoExtendedRoute.test.ts
node --test tests/cli-video-command-contract.test.js tests/video-continuity-ui-contract.test.js tests/cli-skill-command-contract.test.js
npm test
npm run build
```

Runtime smoke:

- Start the server on an isolated port and generated/config dirs.
- API smoke:
  - blank video prompt returns guidance.
  - generated parent-video sidecar produces child lineage.
  - `/api/video/frame` still returns an image.
- CDP smoke:
  - app loads with no console errors.
  - video selected/right panel can render continuity metadata.
  - Classic `Continue here` on a video creates a pending continuation context.
  - Gallery/history video drag to composer attaches last-frame reference and
    lineage metadata.
  - Node parent-video child generation includes lineage in the request body.
- Computer Use smoke:
  - Chrome UI can display the local app and the video controls/continuity panel.
  - If unsure of state, read the app state before each action; do not chain
    clicks through uncertainty.

Employee verification:

- `료`: backend/API/CLI lineage and persistence review.
- `니지카`: frontend UX, loading, right panel, drag/continue review.
- `세이카`: skill/docs/progrok/structure wording review.

Goal must not be marked done until all verification evidence exists and all
employee verdicts are PASS/DONE.

## Risk Register

- `ui/src/store/useAppStore.ts` is already oversized. Keep changes narrow and
  place reusable logic in `ui/src/lib/videoContinuity.ts`.
- `lib/grokVideoAdapter.ts` is at the file-size boundary. Keep lineage
  formatting in `lib/videoContinuity.ts`.
- Server and UI type definitions can drift. Add contract tests and typecheck.
- Topic-based `videoSeries` and branch-local lineage can conflict. Prefer
  explicit lineage; keep topic as legacy context only.
- Drag producer/consumer mismatch can silently drop lineage. Expand both
  producer payloads (`GalleryImageTile`, `HistoryStrip`) and the consumer
  (`PromptComposer`) in the same commit.
- Right panel can display two different concepts: pending continuation context
  and selected result lineage. `VideoControlsPanel` owns pending context;
  `Canvas` owns selected result metadata.
- Last-frame extraction remains client-side for UI. The lineage stack must not
  depend on the frame extractor succeeding; if extraction fails, the prompt
  lineage can still continue from metadata, but UI should surface the reference
  failure.
