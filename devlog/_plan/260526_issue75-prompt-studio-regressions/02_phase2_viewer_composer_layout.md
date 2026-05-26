---
created: 2026-05-26
status: planned
depends_on:
  - 00_overview.md
---

# Phase 2 Viewer And Composer Layout

## Problem

In Prompt Studio, the bottom composer grows with long prompts. The stage above
it has a fixed remaining height, so the image viewer can become so short that
the image appears clipped or ambiguous. Pan interaction is tied to zoomed state,
so users cannot easily inspect the remaining image area when it first appears.

## Planned Implementation

- Cap the Prompt Studio composer height more aggressively and make the textarea
  scroll internally before it consumes viewer space.
- Keep the result image fully contained in the available viewer area by default.
- Keep metadata/actions secondary in Prompt Studio so they do not compete with
  the image canvas.
- Confirm pan/zoom controls remain reachable and obvious at default fit.

## Acceptance

- A long prompt does not push the generated image below an inspectable height.
- The default image view shows the whole image, not an ambiguous crop.
- Desktop, 390px mobile, and 320px narrow checks show no text overlap or
  clipped Korean labels.
