---
created: 2026-05-27
status: verified / pending commit
depends_on:
  - 00_overview.md
---

# Phase 1 Result Preview Layout

## Problem

The main result viewer uses one vertical flex column for:

1. the image preview frame,
2. result metadata,
3. result actions,
4. the generated prompt text.

`.result-prompt` wraps with `word-break: break-word` but has no vertical cap.
For extremely long prompts, the prompt block can grow until the image preview
appears clipped, collapsed, or pushed out of view. This matches #77: download is
normal, while the web preview layout is not.

## Planned Implementation

- Treat generated prompt text as secondary metadata instead of a layout-driving
  peer of the image.
- Clamp `.result-prompt` to a small scrollable preview by default.
- Make the prompt block focusable/clickable with a copy affordance preserved.
- Reserve image preview height in the result viewer by making the image frame a
  bounded flex item with `min-height: 0`.
- Preserve Prompt Studio behavior, where result metadata/actions/prompt are
  hidden and the stage remains image-first.

## Implementation Contract

- `Canvas.tsx` must wrap result prompt text in a class that can be clamped
  without changing the existing copy-on-click behavior.
- `.result-container.visible` must keep the preview frame as the flexible,
  bounded area and prevent prompt metadata from determining the preview height.
- `.result-prompt` must have `max-height` and `overflow-y: auto`.
- The result image must stay contained with `object-fit: contain` and not depend
  on prompt length.

## Acceptance

- With a very long prompt, the visible image preview keeps a meaningful height.
- The prompt text is still visible as a short scrollable/copyable summary.
- Desktop, mobile, and narrow checks do not show clipped Korean labels or image
  preview overlap.

## Implemented

- Added `ResultPromptSummary` as the shared result prompt renderer for Classic
  and Canvas Mode.
- Added `styles/result-preview.css` after viewer styles so #77 layout constraints
  are isolated from the legacy `index.css` baseline.
- Scoped the image sizing override to `.result-preview-frame .result-img` so
  Canvas Mode annotation images are not affected by the long-prompt preview fix.
- Added `tests/issue77-long-prompt-preview-contract.test.js` and refreshed the
  annotation contract to recognize the shared prompt component.
- Refreshed the runtime test inventory after adding the new contract.

## Verified

```bash
node --test tests/canvas-annotation-contract.test.js tests/issue77-long-prompt-preview-contract.test.js tests/prompt-studio-ui-contract.test.js
npm run ui:build
npm run typecheck
npm run typecheck:tests
npm run test:inventory
npm test
```

Visual smoke:

- Chrome URL: `http://127.0.0.1:5173/`
- Fixture: OAuth-style generated image, `1536x2048`, `gpt-5.5`, 35,350-token-like
  prompt.
- Screenshots:
  - `/tmp/ima2-issue77-after-split-desktop.png`
  - `/tmp/ima2-issue77-after-split-mobile390.png`
  - `/tmp/ima2-issue77-after-split-narrow320.png`
  - `/tmp/ima2-issue77-scoped-classic.png`
  - `/tmp/ima2-issue77-canvasmode-scope.png`
