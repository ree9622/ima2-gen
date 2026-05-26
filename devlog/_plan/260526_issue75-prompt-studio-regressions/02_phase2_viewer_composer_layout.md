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
- Preserve separate visual affordances when Multimode and 1:1 Direct are both
  active. Multimode remains the sequence state, while Direct must still be
  visible through the composer class, badge, and active toolbar state.
- Make Prompt Studio bottom composer badge rows wrap instead of clipping the
  Korean/English status labels.

## Implementation Contract

- `PromptComposer` must clamp its autosized textarea to the computed CSS
  `max-height`, so inline `height = scrollHeight` cannot bypass the Prompt
  Studio cap.
- `.composer--bottom` owns a smaller textarea cap than the sidebar composer and
  keeps prompt chips scrollable inside the composer.
- `.composer--direct` must be present even when `.composer--multimode` is also
  present; combined styling handles the two-state border/background.
- The Prompt Studio stage keeps `min-height: 0`, hidden overflow, and
  `object-fit: contain`/`max-height: 100%` image containment.

## Acceptance

- A long prompt does not push the generated image below an inspectable height.
- The default image view shows the whole image, not an ambiguous crop.
- Desktop, 390px mobile, and 320px narrow checks show no text overlap or
  clipped Korean labels.
