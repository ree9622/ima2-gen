---
created: 2026-05-26
status: active / implementation
depends_on:
  - 00_overview.md
---

# Phase 1 Selection And Navigation Stability

## Problem

Prompt Studio currently treats history selection as both "show this image" and
"restore this image's composer snapshot." That is useful in the default Classic
workflow, but it is surprising in Prompt Studio where the bottom composer is a
live drafting surface. The same coupling also leaks into keyboard navigation:
the left recent rail renders a grouped, bounded domain, while arrow keys walk
the full raw gallery history.

The gallery modal has a related state problem. Favorite changes and
favorite/all tab changes rerender the visible set, then the modal recenters the
globally focused image rather than preserving the user's current scroll
position inside the gallery.

## Implementation

- In Prompt Studio, set `restoreComposerFromHistory` to `false`.
- Keep default Classic behavior unchanged: selecting history can still restore
  the composer where that older workflow expects it.
- Route Prompt Studio arrow navigation through the same grouped recent-history
  domain that the sidebar renders, capped by `SIDEBAR_HISTORY_RENDER_LIMIT`.
- Treat multimode sequences as one recent-history entry when navigating the
  Prompt Studio rail.
- Move the gallery opener to the recent-history header so it remains fixed.
- Preserve gallery scroll on favorite toggles and favorite/all tab switches
  unless the modal just opened or the selected image actually changed.

## Acceptance

- Selecting an older image in Prompt Studio changes the viewer but does not
  overwrite the current prompt text.
- Arrow keys in Prompt Studio stop at the visible recent rail boundaries.
- Arrow keys traverse multimode sequences as grouped entries, not completion
  order side effects.
- The gallery button stays visible while the recent list scrolls.
- Favorite toggles do not jump the gallery to a different item.
- Default Classic history selection still restores composer state.
