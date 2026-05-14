---
title: "Canvas Background Removal Library Research"
status: research / options map
created: 2026-05-14
tags: [canvas, background-removal, segmentation, mask, cleanup]
---

# Canvas Background Removal Library Research

## Goal

Record implementation options for improving the current Canvas Mode background
cleanup / background removal flow.

There is no dedicated GitHub issue for this slice at the time of writing. It is
related to the existing Canvas Mode cleanup feature and to #31 masked edit.

## Current Product Context

Current behavior:

- user picks background seeds;
- user can mark remove/preserve regions;
- brush strokes refine the mask;
- tolerance controls flood fill behavior;
- preview and mask overlay are rendered;
- apply creates a transparent PNG canvas version.

Relevant files:

- `ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts`
- `ui/src/components/canvas-mode/backgroundCleanupState.ts`
- `ui/src/lib/canvas/backgroundCleanupMasks.ts`
- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
- `ui/src/styles/canvas-background-cleanup.css`
- `tests/background-cleanup-mask-compose.test.js`
- `tests/background-cleanup-brush-rasterize.test.js`
- `tests/canvas-background-cleanup-contract.test.js`
- `tests/canvas-background-cleanup-2x2-contract.test.js`

## Reference Libraries / Engines

### Current custom flood-fill/brush engine

Role:

- Keep as baseline.
- It is deterministic, local, small, and already tested.

Strength:

- Works well for flat/simple backgrounds.
- Fits current seed/tolerance UI.
- No dependency or model loading cost.

Weakness:

- Does not understand semantic foreground/background.
- Product/object boundaries can need manual cleanup.

Decision:

- Keep.
- Add optional engines rather than replacing it.

### MediaPipe Image Segmenter

Reference:

- https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter/web_js

Role:

- Browser-side segmentation model.
- Can produce mask-like outputs for local processing.

Fit:

- Optional "AI mask" seed engine.
- Good candidate for person/selfie or clear foreground segmentation.

Risks:

- Model loading and runtime cost.
- Segmentation categories may not match all generated image use cases.
- Needs post-processing for edges.

Possible implementation:

- Add `cleanupEngine: "flood-fill" | "segmenter"` state.
- Load model only when user chooses AI cleanup.
- Convert segmenter output into current mask format.
- Keep brush/tolerance refinement after auto-mask.

### MediaPipe Selfie Segmentation

Reference:

- https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/selfie_segmentation.md

Role:

- Person/background segmentation.

Fit:

- Useful for portrait/person background removal.

Risks:

- Too narrow for product images, abstract art, and non-person objects.

Decision:

- Only if product scope explicitly wants portrait cleanup.

### @imgly/background-removal-js

Reference:

- https://github.com/imgly/background-removal-js

Fit:

- High-level background removal in browser/Node.

Blocker:

- AGPL-3.0 license.

Decision:

- Do not add as dependency.
- Reference UX/API only.

### rembg / ONNX style local models

Reference class:

- U^2-Net / RMBG / ONNX Runtime Web based removal tools.

Fit:

- General-object background removal.

Risks:

- Model size.
- Browser memory.
- Runtime portability.
- License/model provenance.
- Need offline cache strategy.

Decision:

- Research separately before adoption.

## Preferred Diff Plan

### Phase 1 — Keep current cleanup, document it

No dependency changes.

Add:

- clearer copy that current cleanup is seed/brush/tolerance based;
- tests that current baseline remains available if optional engines fail.

### Phase 2 — Optional segmentation prototype

Candidate files:

- `ui/src/lib/canvas/segmentationEngine.ts`
- `ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts`

Behavior:

- disabled by default;
- user explicitly selects AI/segment mode;
- model loads lazily;
- output becomes current mask input;
- brush/tolerance can still refine.

### Phase 3 — Model/license decision

Before adding any general removal dependency:

- verify license;
- verify model provenance;
- measure bundle/model size;
- test Chrome/Edge memory;
- verify offline/cache behavior;
- document privacy behavior.

## Tests

Potential contracts:

- current flood-fill cleanup still works without segmentation engine;
- segmentation engine import is lazy;
- model failure returns a clear toast and does not wipe current mask;
- auto mask can be refined with brush;
- generated transparent PNG keeps alpha;
- no raw source image leaves local browser unless user invokes provider edit.

## Notes

Do not conflate background cleanup with provider masked edit.

- Background cleanup creates a local transparent canvas version.
- Masked edit sends image/mask/prompt to a provider.

Those features can share masks, but they have different privacy and provider
semantics.

