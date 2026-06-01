---
created: 2026-04-23
updated: 2026-06-01
tags: [ima2-gen, devlog, roadmap]
aliases: [ima2 active plan, image_gen current roadmap, ima2 개발계획]
---

# ima2-gen 현재 계획 허브

`_plan`은 앞으로 구현하거나 검증할 일이 남은 항목만 둔다. 구현 근거와
테스트가 확인된 항목은 `_fin`으로 이동한다. 완료 여부는 폴더 위치만이 아니라
현재 코드, 테스트, GitHub issue 상태, closeout 증거를 같이 본다.

## Naming Standard

`_plan/` 직속 active 폴더는 다음 두 패턴 중 하나를 따른다.

- `YYMMDD_issue<NN>-<kebab-slug>`: 단일 GitHub 이슈가 canonical scope일 때.
- `YYMMDD_<kebab-slug>`: 단일 이슈가 없는 연구, triage, 다중 이슈 map일 때.

Deferred / 미래 항목은 `_plan/`이 아니라 `devlog/_future/`에 둔다.

## 현재 Active Lane

| 순서 | 경로 | 상태 | 역할 |
|---:|---|---|---|
| 1 | `260430_issue31-provider-masked-edit/` | open / hardened | GitHub #31. Provider-backed masked edit. 업스트림 API 지원 대기 중. |
| 2 | `260430_issue27-canvas-svg-export/` | open / hardened | GitHub #27. Canvas annotation → SVG/vector export. |
| 3 | `260430_issue28-canvas-pptx-export/` | open / hardened | GitHub #28. Canvas → one-slide PPTX. #27 SVG overlay 재사용 경로. |
| 4 | `260514_canvas-library-research/` | research | Canvas export/editing library reference. |
| 5 | `260514_canvas-background-removal-library-research/` | research | Background removal reference. |
| 6 | `260516_issue71-classic-prompt-context-injection/` | planning | GitHub #71. Prompt Studio server-backed context injection. 가장 큰 feature. |
| 7 | `260515_fork-prompting-modularization-research/` | research | Prompt Builder/composer modularization reference. |
| 8 | `260516_agent-mode-followup-jawdev/` | plan | Agent Mode follow-up: layout, queue, parallel gen, sidebar. |
| 9 | `260517_agent-ui-polish-jawdev/` | plan | Agent Mode UI polish/crash triage. |
| 10 | `260529_issue80-batch-comparison-matrix/` | planning / P2 | GitHub #80. Batch comparison matrix. 외부 기여자 제안. |
| 11 | `260531_pr-issue-review-rebase-plan/` | reference | PR #81/#3 통합 계획 + 이슈 triage 문서. |
| 12 | `260531_video-settings-persistence/` | investigated / not fixed | Video setting localStorage persistence. |
| 13 | `260601_video-mode-persistence-refresh/` | investigated / not fixed | Video mode refresh persistence and continue-from-video mode switch. |

## 2026-05-16 GH / Devlog Closeout

이번 pass에서 GitHub issue와 devlog를 대조해 완료 처리한 항목:

| GitHub | 기존 plan 경로 | 이동한 경로 | 완료 근거 |
|---|---|---|---|
| #33/#37/#38 | `_plan/260428_issue33-mobile-overhaul-logs/` | `_fin/260428_issue33-mobile-overhaul-logs/` | mobile UX follow-up issues are closed; logs are archive evidence, not active work. |
| #47 | `_plan/260429_issue47-inflight-reload-reconcile/` | `_fin/260429_issue47-inflight-reload-reconcile/` | GitHub #47 closed; reload reconcile tests exist. |
| #48 | `_plan/260429_issue48-prompt-import-search-ux/` | `_fin/260429_issue48-prompt-import-search-ux/` | GitHub #48 closed; prompt import search workspace contracts exist. |
| none | `_plan/260503_error-toast-stack/` | `_fin/260503_error-toast-stack/` | Error toast stack shipped; `tests/toast-stack-contract.test.js` covers the UI/store contract. |
| #60 | `_plan/260508_issue60-multimode-incremental-progress/` | `_fin/260508_issue60-multimode-incremental-progress/` | GitHub #60 closed; incremental backend/frontend contracts exist. |
| #62 | `_plan/260513_issue62-cli-skill-capabilities/` | `_fin/260513_issue62-cli-skill-capabilities/` | GitHub #62 closed; packaged skill/defaults/capabilities shipped. |
| #59 | `_plan/260514_issue59-generate-as-first-node/` | `_fin/260514_issue59-generate-as-first-node/` | `createRootNodeFromHistoryItem` and visible current-image button are implemented. |
| #63 | `_plan/260515_issue63-delete-focus-recovery/` | `_fin/260515_issue63-delete-focus-recovery/` | GitHub #63 closed; viewer focus recovery contract exists. |
| #64-#70 plus #68/#69 | `_plan/260515_issue64-70-hardening-pabcd/` | `_fin/260515_issue64-70-hardening-pabcd/` | CLI/skill, prompt import, destructive safety, package release, readiness popup, gallery/multimode UX hardening are implemented with contracts. |
| #64-#70 research | `_plan/260515_ux-cli-install-hardening-audit/` | `_fin/260515_ux-cli-install-hardening-audit/` | Research ledger completed; implementation evidence now lives in code/tests and the closeout audit. |
| agent-mode | `_plan/260516_agent-mode-codex-rs-workspace/` | `_fin/260516_agent-mode-codex-rs-workspace/` | Agent Mode workspace/runtime implemented and verified with tests plus agbrowse. |

Detailed issue-to-evidence matrix:

- `_fin/260516_gh-issue-hardening-jawdev/README.md`
- `_fin/260515_issue64-70-hardening-pabcd/README.md`

## 남은 Active Scope

| Issue | Devlog | Next gate |
|---|---|---|
| #31 | `260430_issue31-provider-masked-edit/` | 업스트림 API mask 지원 확인 후 활성화. |
| #27 | `260430_issue27-canvas-svg-export/` | SVG serializer 구현. |
| #28 | `260430_issue28-canvas-pptx-export/` | PptxGenJS export, #27 overlay 재사용. |
| #71 | `260516_issue71-classic-prompt-context-injection/` | 가장 큰 feature. 별도 sprint. |
| #80 | `260529_issue80-batch-comparison-matrix/` | MVP 기획 후 별도 마일스톤 (P2). |
| #84 | — | Common video generation pipeline. Structural refactor, not quick. |
| #85 | — | AssetRef / asset ID model. Structural migration, not quick. |
| #88 | — | Last-frame extraction service abstraction. Current same-origin/server paths work; full fallback chain remains. |
| #89 | — | Source provenance UI for auto-selected I2V sources. Partially covered by lineage metadata, not fully shipped. |
| — | `260531_video-settings-persistence/` | Add video defaults persistence. |
| — | `260601_video-mode-persistence-refresh/` | Persist video mode and select video mode on continue-from-video. |

## 다음 작업 원칙

- 완료된 안정화 폴더는 `_plan`에 다시 끌어오지 않는다.
- 새 구현은 `_plan`의 남은 open issue에서 시작하고, 완료 즉시 `_fin`으로 이동한다.
- `_plan`과 GitHub 상태가 다르면 먼저 GitHub issue body/comments와 현재 코드/test를 확인한다.
- 문서만 갱신한 pass라도 완료/미완료 판정 근거를 `_fin` closeout에 남긴다.

## 변경 기록

- 2026-06-01: `_plan` cleanup pass. `_fin` 이동: `260519_issue72-slash-command-dropup/` (GH #72 implemented; dropup/filter/Tab/arrow/Enter/Escape/click contracts exist), `260531_video-integration-audit/` (audit complete; follow-ups split to #84/#85/#88/#89), `260531_video-phase2-full-api/` (edit/extend/frame/analyze/continue API+CLI shipped), `260531_video-provider-expansion/` (xAI video contract research complete), `260531_video-series-and-agent-tool/` (trash fallback, video topic chain, Agent `ima2.generate_video` shipped), `260601_video-continuity-workflow-research/` (ContinuityJob/lineage/CLI continue/planner prompt guidance shipped). Remaining fast candidates: video defaults persistence, video mode refresh persistence, agent video sidecar atomicity, source provenance chip.
- 2026-05-31: 오늘 66 commits (v1.1.15→v1.1.18) 후 정리. `_fin` 이동: `260529_issue78-prompt-autofill-perf/` (GH #78 closed), `260529_issue79-metadata-ui-polish/` (GH #79 closed), `260530_grok-provider-integration/` (shipped), `260530_grok-publish-pages-readiness/` (shipped), `260530_grok_tool_pipeline/` (shipped), `260531_grok-video-i2v-ship/` (build completion report 확인), `260517_agent-mode-auto-generation-jawdev/` (implementation-patched). PR #81 (Nix flake) + PR #3 (validation errors) 리뷰 및 리베이스 계획 문서화 (`260531_pr-issue-review-rebase-plan/`). 열린 이슈 6개 (#80/#72/#71/#31/#28/#27) 모두 아직 미구현 확인 — 닫을 대상 없음.
- 2026-05-29: 3개 lane 전체 소스코드 검증 + phase 문서 작성 완료. #78: 3 phase (01 autofill fix, 02 img perf, 03 pointer throttle) — `saveGenerationDefaultsPatch` localStorage 오염 추가 발견. #79: 3 phase (01 elapsed/reasoning persistence, 02 metadata display, 03 modal overflow) — overview 원인 정정: 모달 짤림은 `max-height`가 아니라 sidebar `overflow: hidden`이 진짜 원인, AgentModelSheet는 정상. #80: 1 phase (01 MVP design) — Agent Queue/Planner/Runtime 인프라 검증, N개 독립 QueueItem 방식 MVP 설계.
