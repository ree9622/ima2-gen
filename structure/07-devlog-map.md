---
created: 2026-04-23
updated: 2026-05-16
tags: [ima2-gen, devlog, roadmap, doc-ops]
aliases: [ima2 devlog map, image_gen roadmap, devlog map]
---

# Devlog Map

`devlog/_plan` contains active implementation or verification work.
`devlog/_fin` contains completed implementation, completed research, and
closeout evidence. `devlog/_spikes` and `devlog/_future` hold exploratory or
deferred material.

For new planning work, read `devlog/_plan/README.md` first. If an older devlog
contradicts current code, prefer current code plus the active roadmap.

## Current Plan References

| Document | Status | How to use it |
|---|---|---|
| `devlog/_plan/README.md` | current | Active lane and completion moves. |
| `devlog/_plan/260430_issue31-provider-masked-edit/` | active / open #31 | Provider-backed masked edit plan. Keep fail-closed until provider mask contract is proven. |
| `devlog/_plan/260430_issue27-canvas-svg-export/` | active / open #27 | Canvas annotation SVG/vector export. First pass serializes annotations, not raster tracing. |
| `devlog/_plan/260430_issue28-canvas-pptx-export/` | active / open #28 | One-slide Canvas composition PPTX export. Prefer reusing #27 SVG overlay output. |
| `devlog/_plan/260514_canvas-library-research/` | research | Canvas/export library comparison reference. |
| `devlog/_plan/260514_canvas-background-removal-library-research/` | research | Background cleanup/removal library reference. |
| `devlog/_plan/260515_fork-prompting-modularization-research/` | research | Fork/DCInside prompt-builder and workspace modularization notes. |

## 2026-05-16 Completion References

| Completed document | Issues / scope | Evidence summary |
|---|---|---|
| `devlog/_fin/260516_gh-issue-hardening-jawdev/` | #27/#28/#31/#59/#64-#70/#68/#69 plus closed #47/#48/#60/#62/#63 | Prompt-to-artifact audit, issue matrix, implementation evidence, remaining open Canvas scope. |
| `devlog/_fin/260515_issue64-70-hardening-pabcd/` | #64-#70, #68, #69, #59 | CLI/Skill discovery, prompt import wrappers, destructive safety, package release guard, provider readiness popup, first-node action, gallery/multimode UX hardening. |
| `devlog/_fin/260514_issue59-generate-as-first-node/` | #59 | Visible first-node current-image action and `createRootNodeFromHistoryItem`. |
| `devlog/_fin/260515_issue63-delete-focus-recovery/` | #63 | Viewer/Canvas delete focus recovery. |
| `devlog/_fin/260508_issue60-multimode-incremental-progress/` | #60 | Multimode incremental output/polling/partial timeout implementation. |
| `devlog/_fin/260513_issue62-cli-skill-capabilities/` | #62 | Packaged `skills/ima2/SKILL.md`, `ima2 skill`, `capabilities`, `defaults`. |
| `devlog/_fin/260429_issue47-inflight-reload-reconcile/` | #47 | Reload stale-spinner reconciliation and inflight terminal observability. |
| `devlog/_fin/260429_issue48-prompt-import-search-ux/` | #48 | Prompt import results workspace, explicit Preview/Import/Select actions. |
| `devlog/_fin/260503_error-toast-stack/` | toast stack | Bottom-right stacked toast/error rows. |
| `devlog/_fin/260516_agent-mode-codex-rs-workspace/` | Agent Mode | Agent Mode workspace/runtime implementation and agbrowse verification. |

## Roadmap Summary

| Lane | Current interpretation |
|---|---|
| #31 | Open. Provider-backed masked edit must prove upstream mask contract before UI claims true inpaint. |
| #27 | Open. Build deterministic SVG export from source image + annotation model. |
| #28 | Open. Build client-side PPTX export, preferably using #27 overlay output. |
| #59 | Implemented and moved to `_fin`; close GitHub when the issue comment/closure is synced. |
| #64-#70 | Implemented and moved to `_fin`; close GitHub when issue comments/closures are synced. |
| #68/#69 | Implemented as UX hardening under the #64-#70 closeout. |
| Agent Mode | Implemented and moved to `_fin`; future work should start from a new scoped issue. |

## Cleanup Checklist

- [ ] If `_plan/README.md` changes, update this roadmap summary.
- [ ] If a devlog folder moves to `_fin`, update the completion reference table.
- [ ] If code contracts change, update the matching structure docs in current tense.
- [ ] If externally researched content is copied into structure docs, include direct source links.

## Change Log

- 2026-05-16: Replaced the stale historical active-lane table with the actual remaining `_plan` folders. Added the GH issue hardening closeout references and marked #59/#64-#70/#68/#69/Agent Mode as implemented in `_fin`.
