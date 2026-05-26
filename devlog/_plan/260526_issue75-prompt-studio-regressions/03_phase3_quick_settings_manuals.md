---
created: 2026-05-26
status: planned
depends_on:
  - 00_overview.md
---

# Phase 3 Mode State And Quick Settings

## Problem

Multimode and 1:1 Direct are both meaningful generation modifiers, but their
visual language competes inside the composer. The sidebar quick model menu also
only changes the model, even though reasoning effort is a closely related
generation setting.

## Planned Implementation

- Show multimode and direct as distinct, non-clipping state badges when both
  are enabled.
- Give Direct a visible secondary accent even when multimode is active.
- Add reasoning effort choices to the sidebar model quick menu without
  replacing the full settings screen.
- Keep keyboard and pointer behavior accessible for the menu.

## Acceptance

- Both enabled states are visible at the same time.
- Badges wrap or shrink without clipping Korean or English copy.
- Reasoning effort can be changed from the quick menu and remains persisted.
- The full settings screen remains the canonical detailed configuration area.
