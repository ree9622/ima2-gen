---
created: 2026-04-23
updated: 2026-05-27
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
| 1 | `260430_issue31-provider-masked-edit/` | open / hardened | GitHub #31. Provider-backed masked edit. Fail-closed mask gate, clean-raster input policy, OAuth/API provider contract 검증이 남아 있다. |
| 2 | `260430_issue27-canvas-svg-export/` | open / hardened | GitHub #27. Canvas annotation layer를 SVG/vector package로 export. Raster tracing은 scope 밖이다. |
| 3 | `260430_issue28-canvas-pptx-export/` | open / hardened | GitHub #28. Canvas composition을 one-slide PPTX로 export. #27 SVG overlay 재사용이 권장 경로다. |
| 4 | `260514_canvas-library-research/` | research | Canvas export/editing library reference. #27/#28/#31 구현 때 필요한 비교 자료만 참조한다. |
| 5 | `260514_canvas-background-removal-library-research/` | research | Background cleanup/removal reference. 현재 GitHub closeout 대상은 아니다. |
| 6 | `260516_issue71-classic-prompt-context-injection/` | planning | GitHub #71. Classic current prompt injection + quality element prompt context. Prompt Studio 전의 즉시 구현 slice다. |
| 7 | `260515_fork-prompting-modularization-research/` | research / modularization | Prompt Builder, composer, history/viewer modularization reference. #71이 첫 구현 승격 lane이다. |
| 8 | `260516_agent-mode-followup-jawdev/` | plan | Agent Mode follow-up: layout regression, cli-jaw-style nested tool folding, durable queue, parallel image generation, right sidebar model/form/quality controls, and per-session spinners. |
| 9 | `260517_agent-ui-polish-jawdev/` | plan | Agent Mode polish and crash triage: workspace payload safety, layout breakpoint mismatch, settings visual polish, tool height, top model chip, sidebar tab separation. |
| 10 | `260517_agent-mode-auto-generation-jawdev/` | implementation-patched | Agent Mode auto generation policy: deterministic request-aware variants/parallelism, text responses, `/question`, slash commands, manual caps, and queue/tool observability. |
| 11 | `260519_issue72-slash-command-dropup/` | plan | GitHub #72. Agent Composer slash command dropup menu + tab autocomplete. 정적 pill → floating dropup, prefix 필터, 키보드 내비게이션, browser QA. |
| 12 | `260525_empty-response-diagnostics-jawdev/` | completed / pending fin move | GitHub #76. DCInside/Windows OAuth `EMPTY_RESPONSE` diagnostics hardening. Final closeout comment posted and issue closed as completed on 2026-05-27. |
| 13 | `260526_issue75-prompt-studio-regressions/` | completed / pending fin move | GitHub #75. Prompt Studio selection/navigation, viewer/composer layout, multimode/direct state, quick reasoning settings, and manual gaps. Final closeout comment posted and issue closed as completed on 2026-05-27. |
| 14 | `260527_issue77-long-prompt-preview/` | active / phase implementation | GitHub #77. Long generated prompts can make the web preview look clipped or nearly invisible even though the downloaded image is intact. Phase 1 clamps/folds result prompt metadata and reserves image preview height. |

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

As of the current roadmap, the remaining devlog-backed implementation,
verification, or triage scopes are:

| Issue | Devlog | Next implementation gate |
|---|---|---|
| #31 | `260430_issue31-provider-masked-edit/` | Verify provider mask semantics before enabling true masked edit. |
| #27 | `260430_issue27-canvas-svg-export/` | Build direct SVG serializer from current annotation model. |
| #28 | `260430_issue28-canvas-pptx-export/` | Add PptxGenJS export, preferably reusing #27 overlay output. |
| #72 | `260519_issue72-slash-command-dropup/` | Slash command dropup menu + tab autocomplete. 정적 pill 뱃지 → floating dropup, 키보드 내비게이션, prefix 필터링. |
| #77 | `260527_issue77-long-prompt-preview/` | Clamp/fold long result prompts and reserve preview height so the web preview remains visible when generation/download succeed. |

## 다음 작업 원칙

- 완료된 안정화 폴더는 `_plan`에 다시 끌어오지 않는다.
- 새 구현은 `_plan`의 남은 open issue에서 시작하고, 완료 즉시 `_fin`으로 이동한다.
- `_plan`과 GitHub 상태가 다르면 먼저 GitHub issue body/comments와 현재 코드/test를 확인한다.
- 문서만 갱신한 pass라도 완료/미완료 판정 근거를 `_fin` closeout에 남긴다.

## 변경 기록

- 2026-05-16: GitHub issue snapshot과 현재 코드/test를 대조해 #47/#48/#59/#60/#62/#63/#64-#70/#68/#69 및 agent-mode completed folders를 `_fin`으로 이동했다. Active lane은 #31/#27/#28 Canvas follow-up과 research references만 남겼다.
- 2026-05-16: `260515_fork-prompting-modularization-research/` 안의 Agent image focus/sheet regression slice를 구현/QA 기록으로 보강했다. 해당 slice는 `f250784`로 완료됐지만 Prompt Studio modularization 전체는 미완료라 폴더를 `_plan`에 유지한다.
- 2026-05-16: GitHub #71을 열고 `260516_issue71-classic-prompt-context-injection/` planning lane을 추가했다. `cli-jaw`/Codex CLI prompt injection pattern을 참고해 Classic current prompt injection과 quality element injection을 server-backed prompt context manifest로 구현하는 방향이다.
- 2026-05-16: live Agent Mode follow-up 요구사항을 `260516_agent-mode-followup-jawdev/`로 분리했다. 기존 `_fin/260516_agent-mode-codex-rs-workspace/`는 완료 상태로 유지하고, queue/parallel/right-sidebar/session-spinner 작업은 새 active lane에서 추적한다.
- 2026-05-17: Agent Mode UI polish/crash triage lane `260517_agent-ui-polish-jawdev/`와 Agent auto generation planning lane `260517_agent-mode-auto-generation-jawdev/`를 active lane에 추가했다. 후자는 request-aware variants/parallelism, text responses, `/question`, slash commands, and queue/tool/model observability를 차후 구현 scope로 기록한다.
- 2026-05-17: `260517_agent-mode-auto-generation-jawdev/`에 deterministic planner, slash command parser, `/question` text bypass, planned parallelism runtime wiring, right sidebar tab split, composer slash hints, focused contract tests, reviewer concern closure, and Chrome/Computer Use QA closeout를 추가했다. 구현/검증 근거는 해당 lane의 `08_implementation_patch_log.md`가 source of truth이며, 폴더 이동은 별도 closeout 작업에서 처리한다.
- 2026-05-19: GitHub #72를 열고 `260519_issue72-slash-command-dropup/` planning lane을 추가했다. Agent Composer의 정적 slash command pill 뱃지를 floating dropup 메뉴 + Tab 자동완성 + 화살표 키 내비게이션으로 교체하는 작업이다. browser 스킬 기반 QA 체크리스트 포함.
- 2026-05-25: DCInside Windows OAuth `EMPTY_RESPONSE` 제보를 바탕으로 GitHub #76과 `260525_empty-response-diagnostics-jawdev/` planning lane을 추가했다. Classic `generateViaResponses()`의 stream parser, `web_search`/`tool_choice`, image-tool-call hardening, OAuth capability, non-stream fallback, support-safe Windows repro를 분리해 검증한다. 상세 lane 폴더는 로컬 ignored working note이고, 공개 phase report는 #76 comment로 남긴다.
- 2026-05-26: GitHub #75를 `260526_issue75-prompt-studio-regressions/` active lane으로 추가했다. Prompt Studio의 선택/탐색 상태, viewer/composer layout, multimode/direct 상태 표시, quick reasoning 설정, 수동 매뉴얼 보강을 phase별로 구현/검증한다.
- 2026-05-27: GitHub #75/#76은 final closeout comment 후 completed로 닫혔고, `_fin` 이동만 남은 상태로 표시했다. GitHub #77을 `260527_issue77-long-prompt-preview/` active lane으로 추가했다. 긴 생성 프롬프트가 result prompt metadata를 통해 preview height를 잠식하는 frontend layout regression을 phase 1에서 고친다.
