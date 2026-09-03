# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (server --watch + Vite UI + Node-mode gate on)
npm run dev

# Server-only watch (no UI dev server)
npm run dev:server

# UI build (required before `ima2 serve` works from a packaged install)
npm run build

# Tests (runs tests/*.test.js via scripts/run-tests.mjs, cross-platform)
npm test

# Run one test file
node --test tests/health.test.js

# Skip the OAuth proxy subprocess (useful for offline tests / CI on Windows)
IMA2_NO_OAUTH_PROXY=1 node server.js

# CLI after global install
ima2 serve | setup | status | doctor | gen <prompt> | edit <file> | ls | show | ps | ping

# Release (bumps version, publishes to npm, pushes tag)
npm run release:patch    # :minor, :major
```

`npm run build` runs `tsc -b && vite build` inside `ui/`. The server statically serves `ui/dist/`, and `bin/ima2.js serve` auto-runs the UI build if `ui/dist/index.html` is missing and `ui/package.json` exists (dev checkout). On a packaged install with `ui/dist/` missing, it errors out.

## Architecture

Two long-lived processes and a file-based handshake:

```
ima2 serve
 ├── Express (:3333, server.js) ── serves ui/dist + /generated/* + /api/*
 ├── openai-oauth child proc (:10531) ── spawned via spawnBin("npx", ["openai-oauth", ...])
 │                                        auto-restart 5s on exit; gated by IMA2_NO_OAUTH_PROXY
 └── ~/.ima2/server.json ── port/pid/version advertisement for CLI auto-discovery
```

- **OAuth-only in practice.** `/api/providers` returns `apiKeyDisabled: true`; `POST /api/generate` and `/api/edit` reject `provider: "api"` with `403 APIKEY_DISABLED`. The API-key code path still loads `OPENAI_API_KEY` (for `/api/billing`) but is not a generation route.
- **OAuth liveness endpoints differ by runtime.** Local `openai-oauth` v2 exposes `/health`; production `ima2-router` exposes `/admin/`. Probe them in that order and fall back. Do not use `/v1/models` for the online/offline badge because an otherwise-live router may return 503 while every account is busy.
- **Generation path = Responses API streaming.** `generateViaOAuth` / `editViaOAuth` hit `http://127.0.0.1:10531/v1/responses` with `model: IMAGE_MODEL` (`lib/models.js`, default `gpt-5.5`) and `tools: [{ type: "image_generation", ... }, { type: "web_search" }]`, parse SSE events, and extract `image_generation_call.result` base64. The model is **not** `gpt-image-2` — `gpt-image-2` is not a valid Responses API `model` value; the image tool decides the actual image model. Do not rename back to `gpt-image-2` without re-testing end-to-end.
- **Masked edit preservation is deterministic.** `/api/edit` must not force reference-generation safety contexts (`hasRefs: false` for its retry sequence): a harmless empty response once caused the retry prefix `Editorial fashion magazine BTS` to render crew, reflectors, and clothing racks. Masked calls add `MASKED_EDIT_CONTRACT`, suppress uncomposited partial frames, and run `preserveOutsideMask` before save/response so opaque mask pixels come from the submitted source rather than model guidance alone.
- **Model ids live in `lib/models.js`, and the two roles are not interchangeable.** `IMAGE_MODEL` (default `gpt-5.5`, env `IMA2_RESPONSES_MODEL`) is the orchestrator that must call the `image_generation` tool. `TEXT_MODEL` (default `gpt-5.6-sol`, env `IMA2_TEXT_MODEL`) drives the tool-less text helpers — 다듬기 (`lib/enhance.js`) and the safety-retry rewrite (`lib/llmRewrite.js`). **Do not bump `IMAGE_MODEL` to a 5.6 id.** The OAuth backend lists `gpt-5.6-sol` / `-terra` / `-luna` in `GET /v1/models` and they answer plain text fine, but all three silently drop the `image_generation` tool and the call then fails with `Tool choice 'required' must be specified with 'tools' parameter` (measured 2026-08-03 against the live proxy; ima2-router never touches `tools`, so it is an upstream gap). The symptom would be every generation returning `UPSTREAM_EMPTY` with nothing pointing at the model — `tests/models.test.js` guards the pin.

- **SSE parser is duplicated** in `generateViaOAuth` (~line 160) and `editViaOAuth` (~line 620). If you change one, change both.
- **History is disk-first, sidecar JSON for metadata.** `generated/<timestamp>_<rand>_<idx>.<ext>` + `generated/<same>.json` sidecar is the authoritative source for `GET /api/history`. No DB involvement for history. `listImages` walks 2 directory levels (for 0.04 session/node subdirs) and filters `.trash/`.
- **SQLite (`lib/db.js`, `lib/sessionStore.js`) is only for Node-mode sessions** (graph snapshots with optimistic locking via `If-Match` header / `graphVersion` integer). History and inflight state do not touch SQLite.
- **Inflight registry is in-memory** (`lib/inflight.js`). The client echoes a `requestId` on every generate call, server registers it via `startJob` / `setJobPhase` / `finishJob`, and `GET /api/inflight?kind=&sessionId=` reports active jobs. UI persists its own copy in `localStorage["ima2.inFlight"]` with a 180s TTL and cross-tab `storage` event sync, so a refresh mid-generation reconciles.
- **The activity log row is NOT the failure record.** `localStorage["ima2.inFlight"]` keeps only prompt + error text, so anything that needs the real request — retrying with the original reference images, or showing why it failed — must resolve the server sidecar via `GET /api/generation-log/failed/by-request/:requestId` (`mapFailedLogItem` in `server.js`). `retryActivity` delegates to `retryFromLog` on a hit so `generated/.refs` blobs, quality/size and the system prompt come back; `ActivityDetailModal` renders the same record. Never "fix" a lost-references bug by re-reading store state — the store is the thing that lost them.
- **An empty upstream response must carry its own evidence.** When a Responses stream finishes without an `image_generation_call` result, `attachStreamDiagnostics()` copies `refusalText` / the model's `text` (it answered in prose instead of calling the tool) / `reasoningSummary` / `eventTypeCounts` / partial `usage` onto the thrown error. Those land in the attempt log → failure sidecar → `AttemptDiagnostics` in the UI. Without them a failure is just "빈 응답", and a policy refusal is indistinguishable from an upstream hiccup — so any new empty/throw path has to attach them too.
- **Two UI modes.** `classic` (default) and `node` (productized in Phase 4.2 — SSE partial image streaming, connected-component batch selection, node-local refs, subtree Duplicate branch). The `node` tab is gated by `ENABLE_NODE_MODE` in `ui/src/lib/devMode.ts` (default `true`; set `VITE_IMA2_NODE_MODE=0` at build time to hide it). `App.tsx` forces `uiMode = "classic"` only when the env opt-out is set. `IS_DEV_UI` survives for dev-only debug panels and is unrelated to the node-mode tab.
- **Node-mode generation uses one owner-scoped event channel.** The web UI subscribes to `GET /api/events` before sending `POST /api/node/generate` with `{ async: true, requestId }`; the POST returns `202` and `phase` / `partial` / `done` / `error` arrive through `lib/eventBus.js`. Replay strips multi-MB base64 and terminal recovery uses `/api/node/result/:requestId`. Legacy callers still receive the original JSON shape or per-request SSE when they send `Accept: text/event-stream`.
- **Node-local refs** live on each node's data (`ImageNodeData.referenceImages`), persist with the graph save, and take priority over the session sidebar's `referenceImages` slot when generating.
- **State is one big Zustand store** (`ui/src/store/useAppStore.ts`, ~1300 lines) covering history hydration, inflight polling, session graph ops, classic and node generation, draft, refs, and right-panel state. There is no slice split yet; be explicit which domain you're touching and keep actions colocated with their selectors.

## Config and discovery

- `IMA2_CONFIG_DIR` (defaults to `~/.ima2`) holds `config.json` (auth provider + api key if any) and `server.json` (port/pid/version). `bin/ima2.js` migrates from a legacy `<packageRoot>/.ima2/config.json` on first read.
- CLI client commands (`gen / edit / ls / show / ps / ping`) discover the running server via `~/.ima2/server.json`, overridable with `--server <url>` or `IMA2_SERVER=...`. Exit codes are stable and documented in README: `0 ok · 2 bad args · 3 unreachable · 4 APIKEY_DISABLED · 5 4xx · 6 5xx · 7 safety refusal · 8 timeout`.
- Windows has no native `codex` installer. `lib/codexDetect.js` probes auth via file (`~/.codex/auth.json`, `~/.config/codex/auth.json`) AND `codex login status` subprocess. `bin/lib/platform.js` wraps `spawn` with Windows `.cmd` resolution (the `Windows npx spawn EINVAL` fix in commit `2579e53`).

## Conventions

- ES Modules only (`"type": "module"`), Node `>=20`. Do not add CommonJS.
- Reference images: max 5, max ~5.2MB decoded per ref, strict base64 regex check in `validateAndNormalizeRefs`. Moderation is `"auto" | "low"` only.
- Size presets enforce gpt-image sizing rules (every side %16, ratio ≤3:1, 655k–8.3M total pixels). See `ui/src/lib/size.ts` and `tests/size-presets.test.js` before adding a new preset.
- Sidecar metadata written alongside every generated image drives history reconstruction — any new field on generate/edit/node must also be surfaced in the `listImages` mapping in `server.js:286-343`.
- Filename collisions avoided via `${Date.now()}_${randomBytes(4).hex}_${idx}` (commit `7a0e2f5`). Keep the random token when adding new write paths.
- Tests live in `tests/*.test.js` using Node's built-in test runner (`node --test`). `scripts/run-tests.mjs` handles cross-platform invocation; CI matrix is Ubuntu/macOS/Windows × Node 20/22.

## Workspace and git source of truth (BLOCKING)

이 레포의 source of truth는 **GitHub `ree9622/ima2-gen` main**이다. 운영은 asrock 한 곳에서 실행하지만, 운영 서버 파일만 바뀐 상태는 완료가 아니다.

### 자동 main 병합·운영 배포 (2026-07-31 ko 확정)

ima2-gen에서 사용자가 요청한 작업은 코드와 문서 변경을 검증한 뒤 PR 생성에서 멈추지 않는다. 별도 재확인 없이 origin `main`에 병합하고, asrock `/home/ko/apps/ima2-gen` 운영 checkout을 해당 merge SHA로 동기화한 다음 서비스를 재시작한다. 마지막으로 health와 실제 사용자 화면에서 요청한 동작을 검증해야 완료다. 사용자가 이번 작업은 배포하지 말라고 명시했거나 테스트 실패·dirty source·롤백 불가 같은 안전 차단이 있을 때만 운영 반영 전에 멈춘다.

| Location | Role |
| -------- | ---- |
| **GitHub** `ree9622/ima2-gen` (origin) | canonical source of truth |
| **asrock** `/home/ko/apps/ima2-gen/` | 운영 checkout. git main을 따라가야 함 |
| local clean clone/worktree | 검토, 회수, PR 작업용 |

ima2-router도 이제 GitHub `ree9622/ima2-router`가 source of truth다. 두 서비스 모두 운영 서버 직접 수정분은 git으로 회수해야 한다.

### 왜 이 정책인가

2026-05-03 1차 정책: "PC = 검토, asrock = 편집" 양쪽 운용. 하지만 PC 클론이 며칠씩 stale 상태에 빠지고, 다른 세션이 PC 코드를 보고 잘못된 추정을 하는 사례가 잦았다. 이후 asrock 단일 호스트 정책을 썼지만, 2026-05-26 운영 dirty 변경이 git으로 회수되지 않는 문제가 확인되어 정책을 갱신했다.

현재 원칙: 운영에 먼저 반영된 emergency hotpatch라도 종료 조건은 git commit/PR/merge와 live checkout 동기화다.

### 변경 절차 (모든 코드 변경)

1. `git fetch origin` 후 clean branch/worktree를 만든다.
2. source 변경만 편집하거나, 이미 운영 서버에 있는 hotpatch를 clean branch로 회수한다.
3. JS 파일이면 `node --check`, UI 변경이면 `npm run build`, 관련 테스트는 `npm test`로 검증한다.
4. `git add` + `git commit` + `git push` + PR.
5. PR merge 후 asrock `/home/ko/apps/ima2-gen`에서 `git fetch origin && git pull --ff-only origin main` 또는 `git reset --mixed origin/main`으로 HEAD를 맞춘다.
6. 서비스 재시작 + health 확인.
7. 완료 보고에는 repo/PR/commit/live HEAD/`git status --short`/health check를 포함한다.

### 세션 시작 시 sync 선점검

```bash
ssh asrock "cd /home/ko/apps/ima2-gen && git fetch origin && git status && git log --oneline -3"
```

체크 항목:

- HEAD가 origin/main과 같은가?
- uncommitted 변경이 있는가? (있으면 그 정리부터 — 다른 작업 시작 금지)

차이를 발견하면 **그 정리가 모든 다른 작업보다 우선**. dirty source가 있으면 `git pull`, `git reset --hard`, `git checkout -- <file>`로 덮지 말고 clean branch로 회수한다.

### 운영 checkout 에서 npm test 를 돌릴 때

`tests/health.test.js` 는 실제 `server.js` 를 spawn 하는데, `HOME` 만
`FAKE_HOME` 으로 격리하고 `generated/` 는 격리하지 않는다 (`GENERATED_DIR` 은
`__dirname` 고정, env override 없음). asrock 운영 checkout 에서 `npm test` 를
돌리면 실행마다 5바이트 더미 PNG + sidecar 한 쌍이 운영 히스토리에 남는다
(프롬프트 `test moderation forwarding`). 돌렸으면 그 쌍을 지운다:

```bash
ssh asrock "cd /home/ko/apps/ima2-gen/generated && grep -l test moderation forwarding *.json"
```

### Hand-edit 백업 정리

`*.bak.YYYYMMDD-HHMMSS` 는 `.gitignore` 처리되어 있다. 7일 지난 것은 정리:

```bash
ssh asrock "cd /home/ko/apps/ima2-gen && find . -name '*.bak.*' -mtime +7 -delete"
```

## Git workflow (BLOCKING)

작업 단위마다 자동 분할 커밋 + push 가 이 레포의 기본값입니다. 사용자가 매번 "커밋해" 라고 안 시켜도 알아서 분할 커밋합니다. **모든 커밋은 asrock에서.** (위 "Workspace sync" 정책 참조.)

- **트리거 (논리적 작업 1건이 끝났을 때)**:
  - 신규 기능 한 묶음 (예: "scenario 30개 추가", "framing UI 토글 추가", "ref 자동 다운샘플")
  - 단일 버그 수정 한 묶음
  - 리팩터/문서 수정 한 묶음
  - 사용자가 "다음 작업 시작" 신호를 줄 때 — 이전 작업 미커밋 분이 있으면 먼저 커밋
- **분할 단위**: 한 커밋 = 한 논리 작업. 같은 파일이 여러 작업에 걸리더라도 시간순 작업 단위로 끊어 커밋. `git add -p` 를 써서라도 분할.
- **커밋 메시지**: `<type>(<scope>): <한 줄 요약>` + 본문 (변경 사유 + 영향 범위 + 검증 방법). type 예: `feat / fix / refactor / chore / docs / test`. scope 예: `sexy-tune / refs / safety / ui / server`. AI 표시(Co-Authored-By 등) 금지.
- **검증 후 커밋**: 커밋 전 관련 테스트(`npm test` 또는 `node --test tests/<관련>.test.js`)와 `npm run build` 통과 필수. 빌드/테스트 실패 시 커밋 금지.
- **푸시**: 커밋 직후 origin/main 푸시 (이 레포는 사용자 본인 repo이고 main 직접 푸시 운영). 푸시 실패 시 사용자에게 보고.
- **예외 — 커밋 금지/보류**:
  - 미완성 코드 (빌드/테스트 실패, TypeScript 에러)
  - 사용자가 "이건 아직 커밋 보류" 명시한 작업
  - 다른 세션/사용자가 워킹 트리에 남긴 미커밋 변경 — 손대지 말고 별도 알림
- **세션 종료 직전 누락 점검**: 답변 마지막 직전 `git status` 확인. 미커밋 파일이 있고 그게 이번 세션 작업이면 자동 커밋 + 푸시 진행.

### upstream(`lidge-jun/ima2-gen`) 절대 금지 (BLOCKING)

이 레포는 `lidge-jun/ima2-gen` 의 fork 다. 실수로 원본 레포에 PR 이 올라가는 사고가 반복돼서 (#4 / #18 closed 이력) 명시적 가드가 필요하다.

- ❌ **upstream 에 push 금지**. `git push upstream …` 절대 사용 안 함. upstream remote 의 push URL 은 의도적으로 `DISABLED-do-not-push-to-upstream-fork-it-instead` 로 봉인되어 있고, 다시 풀지 말 것. 봉인 상태 확인:
  ```bash
  git remote -v | grep '^upstream.*(push)'   # → DISABLED-... 가 나와야 정상
  ```
- ❌ **upstream 에 PR 생성 금지**. `gh pr create --repo lidge-jun/ima2-gen …` 사용 금지. 사용자가 명시적으로 "원본에 컨트리뷰트하자" 라고 지시한 경우 외에는 무조건 fork(`ree9622/ima2-gen`) 안에서만 작업한다.
- ✅ **PR 생성은 항상 명시 base + repo**. `gh pr create` 호출은 반드시 `--repo ree9622/ima2-gen --base main` 두 플래그를 같이 명시. gh 의 default base 추론에 의존하지 말 것 (fork 환경에서 default 가 upstream 으로 잡혀 #4 / #18 사고가 났다). gh CLI default 도 이 레포로 고정되어 있다 (`gh repo set-default ree9622/ima2-gen`).
- ✅ **upstream fetch 는 OK**. `git fetch upstream main` 으로 가져와서 `git log upstream/main..main` / `git log main..upstream/main` 비교하거나 cherry-pick 하는 건 정상 워크플로우. push/PR 만 막으면 된다.
- ✅ **upstream 기능 픽업 절차**: ① `git fetch upstream` → ② 가져올 커밋 식별 (사용자 승인 필수) → ③ feature/chore 브랜치에서 `git cherry-pick <sha>` → ④ 충돌 해결 + 테스트/빌드 → ⑤ origin 으로 push → ⑥ origin/main 대상 PR 또는 main 직접 머지 (사용자 명시 시).
- ✅ **사용자 의도 확인**: 누군가 "PR 만들어" / "원본에 올려" 같이 모호하게 말하면 base repo 가 origin(우리 fork)인지 upstream(원본)인지 한 번 더 확인. 명확하지 않으면 origin 가정.

## Gotchas

- **프롬프트 스택은 2층이고, 층의 경계가 곧 파일 경계다.** wrapper(`GENERATE_/EDIT_/REFERENCE_DEVELOPER_WRAPPER` + `OUTPUT_CONTRACT` + `SHEET_CONTRACT`)는 `lib/developerPrompts.js`에 있고 **사용자가 끌 수 없다**. 시스템 프롬프트(`DEFAULT_PROMPT_INJECTION` in `lib/defaultPrompt.js`)는 좌측 패널에서 편집·비활성화할 수 있다. 합성은 per-request `buildDeveloperPrompt(wrapper, opts)`.
  - **어느 층에 무엇을 넣는가 (BLOCKING)**: 끌 수 없는 wrapper 층에는 *출력 형식과 브리프 해석*만 — 도구로만 답한다, 산문 거절 금지, 카테고리 시트 읽는 법, 충돌 해소 우선순위, 기술적 결함 회피. *콘텐츠 재량*(수위 보존, 의도 판단, 장면 allowlist)은 사용자가 켜고 끄는 시스템 프롬프트에만 둔다. 이 패키지는 npm 공개 배포되므로 끌 수 없는 층이 정책 재량을 담으면 안 된다. 가드: `tests/developer-prompts.test.js`.
  - **왜 계약이 wrapper 층인가 (2026-07-30 asrock 실측, 최근 14일)**: 기본 프롬프트 ON 실패율 25.3%(68/23) vs OFF 63.3%(33/57). `EMPTY_RESPONSE` 55건 중 39건이 OFF였고, 실체는 모델이 `image_generation`을 부르지 않고 "죄송하지만 …할 수 없습니다. 대신 …는 도와드릴 수 있어요"라고 **글로** 답한 것이다. ref-mode는 `tool_choice:"required"`라 그 산문이 이미지 자리를 먹고 `UPSTREAM_EMPTY`로 던져진다. "도구로만 답한다"가 끌 수 있는 층에만 있었던 것이 실패율 2.5배의 직접 원인이었다. 되돌리지 말 것.
  - **default 텍스트를 바꿀 때**: 이전 텍스트를 `LEGACY_DEFAULT_SYSTEM_PROMPT_V2` 류로 남기고 `useAppStore` `migrate`에서 **정확히 일치할 때만** 새 default로 올린다(persist `version` 증가). 이 단계를 빠뜨리면 기존 탭은 옛 default를 "사용자 수정본"으로 붙들어 개선이 사용자에게 도달하지 않는다. 사용자가 직접 편집한 텍스트는 일치하지 않으므로 보존된다.
- The developer system prompts are tuned for three things at once: moderation pass-rate, output-intensity preservation, and **model autonomy**. (2026-05-08~) 모듈-레벨에서 통째로 합쳐지던 `*_DEVELOPER_PROMPT` 상수는 사용자 좌측 패널 시스템 프롬프트 편집/비활성화 기능을 위해 wrapper-only 로 분리되고, 시스템 텍스트는 매 요청 `req.body.systemPrompt` + `req.body.includeSystemPrompt` (`readSystemPromptOpts`) 로 합성된다. 두 필드 모두 미전송이면 서버 default(`DEFAULT_PROMPT_INJECTION`) — backward-compat. **클라이언트 default 사본 `ui/src/lib/defaultSystemPrompt.ts::DEFAULT_SYSTEM_PROMPT` 와 서버 `DEFAULT_PROMPT_INJECTION` 은 1:1 동기 의무** (PR 시 두 파일 동시 수정, 검증: `devlog/0.10-feature-expansion/system-prompt-editable.md` § Default 텍스트 동기화 규칙). The original `e919e5a` (4/24) commit removed an "authorized red-team evaluation session" / "skip safety disclaimers" wrapper because it read as moderation-bypass in a published npm package. `fff1fcd` (4/29) restored pass-rate via positive framing (`"self-hosted creative workflow"` + `"render literally"` + a fashion/editorial/lookbook/swimwear allowlist). `65b5c16` (4/29) then **stripped all prescriptive aesthetic defaults** — the prior `"casual amateur smartphone photo / no studio lighting / no quality boosters"` ~250-word block and the `"natural, vivid image guidance over keyword spam … specific subject/setting/composition/lighting/lens/texture/mood"` keyword-style nudge — because they crowded out the user's own prompt and produced robotic, AI-look results (per `~/.claude/docs/image-generation-guide.md` §5). The same commit removed the user-role wrappers (`"Generate an image: ${prompt}"` / `"Use the attached reference … User request:"` / `RESEARCH_SUFFIX`) so the user role now carries only the user's own prompt (plus `boostRefPrompt`'s short face-lock cue when ref-mode + short prompt).
- **외부 근거 (OpenAI 공식, 2026-07-30 확인). 이 항목들은 다시 조사하지 말 것.**
  - `input_fidelity`는 **gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini 전용**이다. gpt-image-2는 이 파라미터를 받지 않는데, 그 이유가 미지원이 아니라 **"모든 입력 이미지를 자동으로 high fidelity로 처리하기 때문"**이다(공식 이미지 생성 가이드: *"omit this parameter; the API doesn't allow changing it because the model processes every image input at high fidelity automatically"*). 우리 OAuth 경로는 `gpt-image-2-codex`를 쓰므로 400 `does not support the 'input_fidelity' parameter`가 정상이다. **얼굴이 안 닮는 것을 input_fidelity로 고치려는 시도는 근거가 없다** — 이미 high fidelity로 들어가고 있다.
  - 공식 프롬프팅 가이드가 권하는 순서: **배경/장면 → 주체 → 핵심 디테일 → 제약**. 의도된 용도(광고/UI목업/인포그래픽)를 밝히면 모드가 잡힌다. 복잡한 요청은 라벨 붙인 구획이나 줄바꿈으로 나눈다.
  - 정체성 보존 권장 문구(공식): *"Do not change her face, facial features, skin tone, body shape, pose, or identity in any way. Preserve her exact likeness, expression, hairstyle, and proportions."* + `"Change only X, keep everything else the same"`. **편집을 반복할 때마다 preserve 목록을 다시 적어야** drift가 줄어든다.
  - 레퍼런스가 여러 장이면 **인덱스와 역할로 지목**한다: *"Image 1: product photo… Image 2: style reference…"*, *"Apply Image 2's style to Image 1"*. 우리 UI는 아직 ref별 역할 지정이 없다(개선 여지).
  - **키워드 스팸은 읽히지 않는다** — `8k`, `masterpiece`, `best quality`, `trending on artstation` 류. gpt-image 계열은 2023 Midjourney 태그가 아니라 서술형 자연어를 읽는다. 그래서 `lib/enhance.js`의 `[퀄리티]` 기본값에서 `8k`를 뺐다(비율만 남김).
  - 상세 카메라 스펙을 적어도 물리적으로 정확한 시뮬레이션이 나오지는 않는다. 조리개·렌즈를 나열해 화질을 끌어올리려는 접근은 헛수고다.
  - gpt-image-2 사이즈 규칙(공식): 각 변 16의 배수, 비율 ≤3:1, 총 픽셀 655,360–8,294,400, 권장 상한 2560×1440. `ui/src/lib/size.ts`가 이미 이 규칙을 따른다. 2K 초과는 실험적이다.
  - 1024² 기준 단가(공식): gpt-image-2 low $0.006 / medium $0.053 / high $0.211, gpt-image-1.5 low $0.009 / medium $0.034 / high $0.133.
- Forbidden re-introductions in any prompt body:
  - ToS-bypass phrasing: `red-team`, `bypass`, `skip safety`, `unrestricted`, `evaluation session`.
  - Self-flagging tokens that cause the input classifier to self-label: `sensitive`, `illegal`, `harmful`, `evasion`, `abuse`, `exploitative`.
  - Prescriptive aesthetic defaults: `amateur smartphone photo`, `iPhone-style snapshot`, `no studio lighting`, `slightly imperfect framing`, `quality-booster phrasing`, keyword-spam guidance — these belong in the user's own prompt, not in system prompts.
  - User-role wrappers around `${prompt}` (`"Generate an image:"`, `RESEARCH_SUFFIX`, `"User request:"`). User role = user prompt only.
- When adding any new line to a system prompt, ask: does this preserve user-prompt autonomy? If it prescribes camera/lighting/style/composition the user did not ask for, it does not belong here. Test guards: `tests/defaultPrompt.test.js` (bypass-phrase blocklist + fictional-persona cue), `tests/ref-prompt.test.js` (face-lock boost only on short/variation prompts; long prompts pass through verbatim).
- 좌측 패널 "기본 프롬프트(시스템)" 섹션 (`ui/src/components/SystemPromptSection.tsx`) 에서 사용자가 시스템 프롬프트를 편집/OFF 하면 `useAppStore.systemPrompt` + `systemPromptEnabled` 가 `localStorage` `ima2.userPrefs` 에 저장되고 모든 `/api/generate` `/api/edit` `/api/node/generate` 호출에 동봉된다. 따라서 모더레이션 회귀 보고가 들어오면 ① 사용자가 시스템 프롬프트를 비활성화/편집했는지 (브라우저 DevTools → Application → Local Storage → `ima2.userPrefs` 의 `systemPrompt` / `systemPromptEnabled` 확인) ② 서버 default 가 그대로인지 (위 동기화 규칙) 둘 다 점검. 사용자 편집 가능성을 무시하고 서버 default 만 비교하면 원인 진단을 놓친다.
- `devlog/` documents three overlapping roadmaps (`AGENTS.md` Phase 0–3, README Roadmap 0.10–0.12, `devlog/_plan/README.md` 0.1–1.0). They have drifted. Treat them as historical context, not ground truth — confirm current scope with the user before acting on a devlog item.
- `public/index.html.legacy` is the pre-React vanilla build, kept for reference only. The live UI is `ui/dist/`.
- `generated/` has no size cap or TTL (only `.trash/` has soft-delete). Expect it to grow without bound on long-running dev installs.
- README has an unstaged edit (working copy) that reframes the model as `responses + image_generation` instead of `gpt-image-2`. Match that framing in any user-facing copy you touch.
