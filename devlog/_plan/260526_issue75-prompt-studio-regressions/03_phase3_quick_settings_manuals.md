---
created: 2026-05-26
status: implemented
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

## Implementation Contract

- The existing sidebar model trigger remains the quick entry point, but the
  popup becomes a grouped menu with two independent radio groups: image model
  and reasoning effort.
- The trigger exposes the current model and reasoning short labels on desktop,
  while narrow mobile keeps the compact model-only button to avoid clipping.
- Reasoning selection must call the same persisted store action as the full
  settings screen (`setReasoningEffort`) so both surfaces stay synchronized.
- The full settings screen remains the detailed explanatory home for reasoning
  copy; the quick menu is only a fast selector.

## Acceptance

- Both enabled states are visible at the same time.
- Badges wrap or shrink without clipping Korean or English copy.
- Reasoning effort can be changed from the quick menu and remains persisted.
- The full settings screen remains the canonical detailed configuration area.

## Verification

- Focused contract: generation controls, direct-mode visual state, and Prompt
  Studio UI contracts pass.
- Static gates: root typecheck, test typecheck, inventory check, UI build, and
  `git diff --check` pass.
- Full regression: `npm test` passes 802 tests.
- Browser smoke at `127.0.0.1:3333`: desktop quick menu keyboard selection
  persisted `xhigh` and settings reflected it; 390px and 320px mobile
  viewports kept the compact trigger and menu inside the viewport.
- Read-only sub-agent verification returned PASS for quick-menu state,
  persisted reasoning selection, settings preservation, keyboard behavior, and
  mobile clipping coverage.
