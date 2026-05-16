---
created: 2026-04-23
updated: 2026-05-16
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

## 남은 GitHub Open Scope

As of the 2026-05-16 audit, the only devlog-backed GitHub issues that still
require implementation are:

| Issue | Devlog | Next implementation gate |
|---|---|---|
| #31 | `260430_issue31-provider-masked-edit/` | Verify provider mask semantics before enabling true masked edit. |
| #27 | `260430_issue27-canvas-svg-export/` | Build direct SVG serializer from current annotation model. |
| #28 | `260430_issue28-canvas-pptx-export/` | Add PptxGenJS export, preferably reusing #27 overlay output. |

## 다음 작업 원칙

- 완료된 안정화 폴더는 `_plan`에 다시 끌어오지 않는다.
- 새 구현은 `_plan`의 남은 open issue에서 시작하고, 완료 즉시 `_fin`으로 이동한다.
- `_plan`과 GitHub 상태가 다르면 먼저 GitHub issue body/comments와 현재 코드/test를 확인한다.
- 문서만 갱신한 pass라도 완료/미완료 판정 근거를 `_fin` closeout에 남긴다.

## 변경 기록

- 2026-05-16: GitHub issue snapshot과 현재 코드/test를 대조해 #47/#48/#59/#60/#62/#63/#64-#70/#68/#69 및 agent-mode completed folders를 `_fin`으로 이동했다. Active lane은 #31/#27/#28 Canvas follow-up과 research references만 남겼다.
- 2026-05-16: `260515_fork-prompting-modularization-research/` 안의 Agent image focus/sheet regression slice를 구현/QA 기록으로 보강했다. 해당 slice는 `f250784`로 완료됐지만 Prompt Studio modularization 전체는 미완료라 폴더를 `_plan`에 유지한다.
- 2026-05-16: GitHub #71을 열고 `260516_issue71-classic-prompt-context-injection/` planning lane을 추가했다. `cli-jaw`/Codex CLI prompt injection pattern을 참고해 Classic current prompt injection과 quality element injection을 server-backed prompt context manifest로 구현하는 방향이다.
