# 10 PABCD Implementation Plan — Grok Video Continuity UX + Contracts

## Goal

Implement the confirmed Grok video continuity workflow hardening without expanding the frontend into a full V2V editor.

The implementation must:

1. Keep the primary frontend video surface simple:
   - 0 refs: text-to-video
   - 1 ref: image-to-video
   - 2+ refs: reference-to-video
2. Enforce the Ref2V contract:
   - 2+ refs max 10 seconds
   - resolution and aspect controls remain available
   - `grok-imagine-video-1.5-preview` does not claim Ref2V support
3. Make model fallback visible:
   - Persist requested model and effective model separately when fallback occurs
   - Prevent result/history analysis from mislabeling base-model Ref2V as 1.5 Ref2V
4. Improve continuity UX:
   - Dragging a gallery/history video into the prompt composer attaches only its last frame as a reference image
   - Dragging an image remains the existing reference-image behavior
5. Strengthen video prompt planning and skill docs:
   - Structured video prompt template
   - Expected motion, dialogue, music, no-music, sound-effects-only, ending frame, and continuity handoff guidance
   - Explicit CLI/progrok edit/extension contracts

## PABCD Breakdown

### P — Plan

Evidence already gathered:

- Direct xAI/progrok contract smoke:
  - `grok-imagine-video-1.5-preview` rejects `reference_images`
  - `grok-imagine-video` accepts Ref2V up to 10 seconds and rejects 15 seconds
- Local comparison artifacts:
  - `/Users/jun/Developer/ima2_grok_contract_compare_260601_1554`
  - 35 baseline media files + five 10s 720p Ref2V comparison outputs
- Current frontend:
  - UI already clamps 2+ refs to 10 seconds
  - prompt composer already handles internal image reference drag
  - history strip video items are draggable
  - gallery modal tiles are not draggable yet

### A — Architecture

Backend/API:

- Extend Grok video result metadata with `requestedModel`, `effectiveModel`, and `modelFallback`.
- Route sidecar metadata should use `effectiveModel` as canonical `model`, while retaining `requestedModel`.
- SSE done payload should expose the same information through the existing `video` metadata object.

Frontend:

- Add a helper that turns an internal drag payload into a prompt reference:
  - video item: `extractLastFrame(src)` then `addReferenceDataUrl(frame)`
  - image item: existing `useImageAsReference`
- Add drag payload support to gallery modal tiles.
- Avoid prompt text injection on drag.

Prompt/Skill:

- Strengthen Grok video planner instructions to require structured motion/audio/end-frame thinking.
- Update `skills/ima2/SKILL.md` with the corrected endpoint/model matrix and continuity prompt templates.

### B — Build

Planned edits:

- `lib/grokVideoAdapter.ts`
- `routes/video.ts`
- `ui/src/components/PromptComposer.tsx`
- `ui/src/components/GalleryImageTile.tsx`
- `lib/promptBuilder/systemPrompt.ts` or video planner prompt block, depending on exact owner after final inspection
- `skills/ima2/SKILL.md`
- focused tests under `tests/`

### C — Check

Local verification must include:

- TypeScript:
  - `npm run typecheck`
  - `npm run typecheck:tests`
- Focused tests:
  - `node --import tsx --test tests/grokVideoAdapter.test.ts tests/videoRoute.test.ts`
  - targeted UI source-contract tests for prompt composer/gallery drag
  - targeted CLI/skill contract tests where updated
- Full test if focused tests pass:
  - `npm test`

Runtime smoke target:

- CDP smoke on running local server if frontend changes are not purely source-contract checked.

### D — Dispatch / External Verification

Before marking complete:

- Dispatch `료` for backend/API metadata and contract review.
- Dispatch `니지카` for frontend drag/drop UX and user-facing model display review.
- Dispatch `세이카` for skill/docs/progrok contract review.
- Any NEEDS_FIX result must be acted on before completion.

### Done Criteria

This goal is complete only when all are true:

1. Every planned code/doc surface is implemented or explicitly ruled out with evidence.
2. Local verification commands pass with current output.
3. External jaw employee reviews return PASS/DONE, or all NEEDS_FIX findings are fixed and re-reviewed.
4. No known contract ambiguity remains around:
   - 1.5 Ref2V
   - base Ref2V max duration
   - edit/extension model support
   - video drag last-frame reference behavior
   - audio/dialogue/music prompt-control limits
5. The final report cites exact files and verification evidence.
