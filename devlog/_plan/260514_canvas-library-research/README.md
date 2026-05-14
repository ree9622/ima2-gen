---
title: "Canvas Library Reference Research"
status: research / reference map
created: 2026-05-14
tags: [canvas, libraries, svg, pptx, background-removal, mask-edit]
sources:
  - https://github.com/lidge-jun/ima2-gen/issues/27
  - https://github.com/lidge-jun/ima2-gen/issues/28
  - https://github.com/lidge-jun/ima2-gen/issues/31
  - https://github.com/lidge-jun/ima2-gen/issues/59
---

# Canvas Library Reference Research

## Purpose

This document records the library/reference research requested by Jun on
2026-05-14. The scope is not an immediate dependency change. It is a reference
map for the next Canvas Mode implementation slices:

- #27 Canvas annotation SVG/vector export
- #28 Canvas composition PPTX export
- #31 provider-backed masked edit
- #59 generate current viewer/canvas image as the first node
- background cleanup / background removal improvements

The current app already has a custom Canvas Mode implementation with zoom, pan,
annotations, eraser, background cleanup masks, alpha/matte export, canvas
versions, and mask-guided edit groundwork. The default decision is therefore:

> Do not rewrite Canvas Mode around a new canvas framework unless a specific
> issue needs an object model that the current code cannot support.

## Current Ima2 Anchors

Important existing files and contracts:

- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`
  - Canvas Mode shell, image display, annotation frame, ResultActions hook point.
- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
  - Toolbar actions for annotation, eraser, cleanup, export controls.
- `ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts`
  - Current seed/brush/tolerance background cleanup state machine.
- `ui/src/lib/canvas/backgroundCleanupMasks.ts`
  - Flood-fill/brush mask generation primitives.
- `ui/src/lib/canvas/maskRenderer.ts`
  - Mask PNG rendering for guided edit.
- `routes/edit.ts`
  - Edit endpoint and mask validation.
- `lib/responsesImageAdapter.ts`
  - API-key Responses image adapter; current mask is passed as guidance.
- `lib/oauthProxy/generators.ts`
  - OAuth image request builder and masked-edit feature gate.
- `tests/canvas-background-cleanup-contract.test.js`
  - Current cleanup UX and mask behavior contracts.
- `tests/edit-mask-api-contract.test.js`
  - Mask validation and guided-edit routing contracts.
- `tests/oauth-masked-edit-contract.test.js`
  - OAuth masked-edit gate contract.

## Library Candidates

### Fabric.js

Reference:

- https://github.com/fabricjs/fabric.js
- https://fabricjs.com/docs/
- https://fabricjs.com/docs/why-fabric/

Fit:

- Strong object model for images, paths, shapes, text, selection, grouping, and
  export.
- Relevant to #27 if Canvas Mode eventually moves from custom annotation
  objects to a canvas object model.
- Relevant to #31 if mask brush UX needs mature object/brush tooling.

Why not immediately rewrite around it:

- The app already has a custom Canvas Mode subtree and tests.
- Fabric is imperative; React synchronization must be handled carefully.
- It is a large dependency compared to the narrow #27/#28 needs.
- SVG export can become a security surface if untrusted Fabric JSON is loaded
  and exported as SVG.

Security note:

- Fabric has a reported SVG export XSS path when attacker-controlled JSON is
  loaded and then exported. If Fabric is adopted, never load untrusted Fabric
  JSON into an export path without sanitization.
- Reference: https://advisories.gitlab.com/npm/fabric/CVE-2026-27013/

Decision:

- Reference first.
- Scoped adoption only if future Canvas Mode needs selection/group/layer
  behavior that the custom model cannot provide.

### Konva / react-konva

Reference:

- https://github.com/konvajs/konva
- https://konvajs.org/docs/

Fit:

- Declarative React-friendly canvas layers, events, shapes, and transforms.
- Useful if Canvas Mode is ever rebuilt as a React layer graph.

Risks:

- Less built-in editor behavior than Fabric.
- SVG/PPTX export still needs custom serialization.
- Does not directly solve #27 or #28 faster than current data-model export.

Decision:

- Good design reference for layer/event structure.
- Not the first dependency for current issue set.

### PptxGenJS

Reference:

- https://github.com/gitbrent/PptxGenJS

Fit:

- Directly relevant to #28.
- Browser/Node PPTX generation with images, SVGs, text boxes, shapes, and
  layouts.
- Can export a one-slide deck from current Canvas state without server writes.

Recommended role:

- Direct adoption for #28.
- Use current Canvas image as a slide image.
- Use #27 SVG overlay or direct PowerPoint shapes for annotations.
- Keep raster fallback for complex freehand strokes.

Decision:

- Best immediate dependency candidate.

### canvas2svg

Reference:

- https://github.com/gliffy/canvas2svg

Fit:

- Captures Canvas 2D drawing commands into SVG.
- Potentially useful as a reference for converting draw operations into SVG.

Risks:

- Older, narrower, no editor state model.
- If ima2 already owns annotation JSON, direct annotation-to-SVG serialization is
  simpler and more testable.

Decision:

- Reference only.

### MediaPipe Image Segmenter / Selfie Segmentation

Reference:

- https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter/web_js
- https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/selfie_segmentation.md

Fit:

- Browser-side segmentation that can produce masks.
- Good for person/selfie background cleanup and local preview workflows.
- Can feed existing background cleanup mask overlay / canvas version pipeline.

Risks:

- Person/selfie segmentation is not enough for all product/object backgrounds.
- Needs model loading UX and performance budget.
- Edge quality may require post-processing.

Decision:

- Optional engine for background cleanup.
- Prototype behind a feature flag before user-facing default.

### @imgly/background-removal-js

Reference:

- https://github.com/imgly/background-removal-js

Fit:

- High-level browser/Node background removal.
- Likely stronger for generic background removal than simple flood fill.

Blocker:

- License is AGPL-3.0.

Decision:

- Do not add as a dependency.
- May be used only as UX/API reference.

### react-canvas-masker

Reference:

- https://github.com/3rChuss/react-canvas-masker

Fit:

- Brush mask editing, zoom/pan, undo/redo, PNG mask output.
- Useful reference for #31 masked edit UX and current cleanup brush tools.

Risks:

- Smaller project.
- License metadata should be checked from the repository before any dependency
  addition.
- Current ima2 already has mask/cleanup primitives.

Decision:

- Reference UX patterns.
- Do not adopt wholesale unless it saves real implementation time.

## Cross-Issue Recommendation

Preferred order:

1. #59 generate as first node
   - No library needed.
   - Small UX/store action slice.
2. #27 SVG/vector export
   - Implement direct serializer from current annotation model.
   - Use Fabric/canvas2svg as reference, not dependency.
3. #28 PPTX export
   - Adopt PptxGenJS.
   - Reuse #27 SVG exporter or shape serializer.
4. #31 provider-backed masked edit
   - Verify provider mask contract first.
   - Use current mask renderer and react-canvas-masker UX reference.
5. Background removal upgrade
   - Keep current flood-fill/brush cleanup.
   - Prototype MediaPipe segmentation as optional mask seed engine.
   - Avoid AGPL dependencies.

## Implementation Comments

- Keep the current custom Canvas Mode unless a specific feature proves the data
  model is insufficient.
- Do not add Fabric just for SVG export.
- Do not add a background-removal dependency before license/model-size/runtime
  evaluation.
- PptxGenJS is the only candidate that currently looks like a direct dependency
  for a near-term issue.
- If any dependency is added, update `package.json`, package smoke expectations,
  `docs/CLI.md`, and the relevant contract tests in the same patch.

