---
created: 2026-05-15
tags: [ima2-gen, fork-research, prompt-builder, modularization]
status: research / modularization plan
sources:
  - https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1182644&search_head=120&page=1
  - https://github.com/damagethundercat/ima2-gen
---

# Fork Prompting Modularization Research

This folder records a source audit and modularization plan for the `damagethundercat/ima2-gen` fork and the related DCInside post. The goal is not to merge the fork directly, but to identify which prompting and workflow ideas are worth reimplementing in the upstream architecture without regressing existing issue work.

## Documents

| File | Purpose |
|---|---|
| [00_overview.md](00_overview.md) | High-level conclusion, source summary, adoption stance, and recommended lane. |
| [01_source_audit.md](01_source_audit.md) | Detailed fork/post audit, changed file map, useful ideas, and regressions to avoid. |
| [02_modularization_plan.md](02_modularization_plan.md) | Diff-style implementation slices for prompt-builder backend, prompt-builder frontend, and composer metadata restore. |
| [03_layout_history_viewer_plan.md](03_layout_history_viewer_plan.md) | Follow-up slices for classic layout, sidebar history, viewer zoom/pan, CSS, and attribution guardrails. |
| [04_risks_acceptance.md](04_risks_acceptance.md) | Risk ledger, acceptance criteria, test matrix, and suggested GitHub issue split. |
| [05_workspace_profile_cli_contract.md](05_workspace_profile_cli_contract.md) | Jawdev-style workspace profile abstraction, settings plan, and CLI command contract. |
| [07_agent_image_focus_sync_qa.md](07_agent_image_focus_sync_qa.md) | 2026-05-16 Agent image focus/sheet QA implementation note, verification evidence, and remaining-lane status. |

## Core Decision

Reimplement the workflow, not the fork shape. The fork is valuable as a UX/prototyping reference for prompt-building, composer flow, sidebar history, and viewer polish, but several files are too large, duplicate existing upstream contracts, or conflict with recently shipped upstream fixes.

More specifically, treat the fork as a configurable `Prompt Studio` workspace profile. The profile can change the browser layout and prompt-authoring surfaces, but CLI generation commands must remain stable and unaffected by UI-only profile settings.

## Recommended Starting Slice

Start with the prompt system lane:

1. Prompt Builder backend endpoint and structured-output contract.
2. Prompt Builder panel and isolated builder-session store.
3. Composer block ordering plus history metadata restore.

Defer larger layout changes, sidebar history grouping, and zoom/pan polish until the prompt builder flow is stable.

## 2026-05-16 Implementation Note

The Agent image focus and responsive sheet regression found during this lane was implemented and verified in commit `f250784` (`[agent] fix: sync agent image focus`). This does not complete the full Prompt Studio / fork modularization lane, so the folder remains in `_plan` instead of moving to `_fin`.

The first promoted implementation issue from this research lane is GitHub #71:

```text
devlog/_plan/260516_issue71-classic-prompt-context-injection/
```

#71 focuses on the immediate Classic current-prompt injection and quality-element injection slice before the full Prompt Builder panel.

## Guardrails

- Do not port the fork package rename, binary rename, or distribution branding.
- Do not replace current `ResultActions` or `HistoryStrip` wholesale; upstream already has first-node action, delete focus recovery, and shared gallery identity helpers.
- Keep new modules under 500 lines and avoid expanding `useAppStore.ts` as the primary integration surface.
- Verify license/attribution before copying any substantial fork code; prefer reimplementation from observed behavior.
- Keep CLI behavior explicit: use `ima2 prompt build` for prompt-builder output, and keep `ima2 gen` / `ima2 edit` / `ima2 multimode` as generation commands.
- This devlog folder is ignored by the default `devlog/` rule; force-add it when committing the research lane.
