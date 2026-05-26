---
created: 2026-05-26
status: implemented
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

## Implementation Contract

- Create a focused Prompt Studio manual rather than expanding the README into a
  long feature guide.
- Keep English and Korean support surfaces aligned: README/FAQ link to the
  English manual, and Korean README/FAQ link to the Korean manual.
- Document the user's confusing areas explicitly: multimode slots, Direct mode,
  reasoning effort, recent history, gallery favorites, and prompt import
  actions.
- Add a docs contract test so future feature edits cannot silently remove the
  manual links or issue #75 support guidance.

## Acceptance

- A new user can understand what Prompt Studio, multimode, Direct, reasoning,
  and gallery favorites do without reading source code.
- Multimode docs explain that each slot is a separate image request target, not
  a collage panel.
- Docs stay synced across README/FAQ surfaces that already carry user-facing
  troubleshooting content.

## Verification

- Focused docs contract: `node --test tests/prompt-studio-docs-contract.test.js`
  passes.
- Focused Prompt Studio contracts: docs, Prompt Studio UI, and generation
  controls UX contracts pass together.
- Static gates: root typecheck, test typecheck, UI no-emit typecheck, UI build,
  inventory check, and `git diff --check` pass.
- Full regression: `npm test` passes 805 tests.
- Read-only sub-agent verification returned PASS for links, English/Korean
  parity, multimode/Direct/reasoning/gallery guidance, file length, and
  CommonJS constraints.
