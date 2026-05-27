---
created: 2026-04-23
updated: 2026-05-27
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
| `devlog/_plan/260516_issue71-classic-prompt-context-injection/` | planning | GitHub #71 Classic current prompt injection plus quality element prompt context. |
| `devlog/_plan/260516_agent-mode-followup-jawdev/` | plan | Agent Mode follow-up for stable layout, nested tools, durable queue, parallel image generation, right sidebar model/form/quality controls, and session-specific spinners. |
| `devlog/_plan/260517_agent-ui-polish-jawdev/` | plan | Agent Mode UI polish and runtime crash triage after the follow-up implementation. |
| `devlog/_plan/260517_agent-mode-auto-generation-jawdev/` | implementation-patched | Agent Mode auto generation policy: deterministic request-aware variants/parallelism, text responses, `/question`, slash commands, and plan observability. |
| `devlog/_plan/260519_issue72-slash-command-dropup/` | plan | GitHub #72 Agent Composer slash command dropup menu plus tab autocomplete. |
| `devlog/_plan/260525_empty-response-diagnostics-jawdev/` | completed / pending fin move | GitHub #76 OAuth/Responses `EMPTY_RESPONSE` diagnostics hardening. Final closeout comment posted and issue closed as completed on 2026-05-27. |
| `devlog/_plan/260526_issue75-prompt-studio-regressions/` | completed / pending fin move | GitHub #75 Prompt Studio regressions. Final closeout comment posted and issue closed as completed on 2026-05-27. |
| `devlog/_plan/260527_issue77-long-prompt-preview/` | active / phase implementation | GitHub #77 long prompt preview layout regression: clamp/fold result prompt metadata and reserve web preview height. |

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
| #71 | Active planning. Classic current prompt injection and quality element context before Prompt Studio. |
| #72 | Active planning. Slash command dropup menu, prefix filtering, tab autocomplete, and keyboard navigation. |
| #76 | Completed on GitHub. Awaiting `_fin` movement of the existing lane. |
| #75 | Completed on GitHub. Awaiting `_fin` movement of the existing lane. |
| #77 | Active phase implementation. Long result prompt metadata must not hide or squeeze the generated image preview. |
| #59 | Implemented, moved to `_fin`, and closed on GitHub during the 2026-05-16 closeout. |
| #64-#70 | Implemented, moved to `_fin`, and closed on GitHub during the 2026-05-16 closeout. |
| #68/#69 | Implemented as UX hardening under the #64-#70 closeout and closed on GitHub. |
| Agent Mode | Implemented and moved to `_fin`; future work should start from a new scoped issue. |
| Agent Mode follow-up | Active. New Jawdev plan created for layout regression, tool double folding, queue, parallel generation, right sidebar controls, model settings sync, and per-session spinners. |
| Agent UI polish | Active. Follow-up polish lane for workspace payload safety, layout mismatch, settings visual quality, tool height, top model chip visibility, and sidebar tab separation. |
| Agent auto generation | Active implementation lane. Deterministic planner, slash commands, `/question`, text response summary, planned variants/parallelism observability, right sidebar/model sheet UI, focused contracts, reviewer concern closure, and Chrome/Computer Use QA are recorded; `_fin` movement is a separate closeout step. |
| Empty Response diagnostics | Active plan. Classify OAuth/Responses no-image failures with sanitized stream fingerprints, doctor probes, parser/payload hardening, image-tool-call hardening, prompt-only fallback, and Windows support repro evidence. Public reports live in GitHub #76 comments while the detailed lane folder remains an ignored local working note unless force-added. |

## Cleanup Checklist

- [ ] If `_plan/README.md` changes, update this roadmap summary.
- [ ] If a devlog folder moves to `_fin`, update the completion reference table.
- [ ] If code contracts change, update the matching structure docs in current tense.
- [ ] If externally researched content is copied into structure docs, include direct source links.

## Change Log

- 2026-05-16: Replaced the stale historical active-lane table with the actual remaining `_plan` folders. Added the GH issue hardening closeout references and marked #59/#64-#70/#68/#69/Agent Mode as implemented in `_fin`.
- 2026-05-16: Added `260516_agent-mode-followup-jawdev/` as the active Agent Mode follow-up lane instead of reopening the completed Agent Mode closeout.
- 2026-05-17: Added `260517_agent-ui-polish-jawdev/` and `260517_agent-mode-auto-generation-jawdev/` to the active plan references and roadmap summary.
- 2026-05-17: Updated Agent auto generation lane status after first implementation patch and focused contract verification.
- 2026-05-25: Added GitHub #76 and `260525_empty-response-diagnostics-jawdev/` for DCInside Windows OAuth `EMPTY_RESPONSE` triage and planned Responses/OAuth diagnostic hardening, including image-tool-call hardening. Recorded that public phase reports live in #76 comments while the detailed lane folder remains a local ignored working note unless force-added.
- 2026-05-26: Added GitHub #75 and `260526_issue75-prompt-studio-regressions/` for Prompt Studio regression implementation. Phase 1 covers prompt selection side effects, sidebar shortcut domain bounds, fixed gallery opener, and gallery viewport preservation.
- 2026-05-27: Marked GitHub #75/#76 as completed after final closeout comments, and added GitHub #77 plus `260527_issue77-long-prompt-preview/` for long-prompt result preview layout hardening.
