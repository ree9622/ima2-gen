---
created: 2026-05-26
status: planned
depends_on:
  - 00_overview.md
---

# Phase 4 Manual And Closeout

## Problem

The public README and FAQ mention features but do not give enough operational
guidance for Prompt Studio, multimode prompting, direct mode, gallery favorites,
reasoning effort, and diagnostic/reporting workflows.

## Planned Implementation

- Add a concise Prompt Studio manual section to the public docs.
- Add multimode prompt recipes that explain how to request related images and
  when unrelated outputs are expected.
- Clarify which actions intentionally import prompts versus which selections
  are view-only.
- Add issue #75 closeout notes and support-safe repro guidance.

## Acceptance

- A new user can understand what Prompt Studio, multimode, Direct, reasoning,
  and gallery favorites do without reading source code.
- Multimode docs explain that each slot is a separate image request target, not
  a collage panel.
- Docs stay synced across README/FAQ surfaces that already carry user-facing
  troubleshooting content.
