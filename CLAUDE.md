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
- **Generation path = Responses API streaming.** `generateViaOAuth` / `editViaOAuth` hit `http://127.0.0.1:10531/v1/responses` with `model: "gpt-5.5"` and `tools: [{ type: "image_generation", ... }, { type: "web_search" }]`, parse SSE events, and extract `image_generation_call.result` base64. The model is **not** `gpt-image-2` — `gpt-image-2` is not a valid Responses API `model` value; the image tool decides the actual image model. Do not rename back to `gpt-image-2` without re-testing end-to-end.
- **SSE parser is duplicated** in `generateViaOAuth` (~line 160) and `editViaOAuth` (~line 620). If you change one, change both.
- **History is disk-first, sidecar JSON for metadata.** `generated/<timestamp>_<rand>_<idx>.<ext>` + `generated/<same>.json` sidecar is the authoritative source for `GET /api/history`. No DB involvement for history. `listImages` walks 2 directory levels (for 0.04 session/node subdirs) and filters `.trash/`.
- **SQLite (`lib/db.js`, `lib/sessionStore.js`) is only for Node-mode sessions** (graph snapshots with optimistic locking via `If-Match` header / `graphVersion` integer). History and inflight state do not touch SQLite.
- **Inflight registry is in-memory** (`lib/inflight.js`). The client echoes a `requestId` on every generate call, server registers it via `startJob` / `setJobPhase` / `finishJob`, and `GET /api/inflight?kind=&sessionId=` reports active jobs. UI persists its own copy in `localStorage["ima2.inFlight"]` with a 180s TTL and cross-tab `storage` event sync, so a refresh mid-generation reconciles.
- **Two UI modes.** `classic` (default) and `node` (productized in Phase 4.2 — SSE partial image streaming, connected-component batch selection, node-local refs, subtree Duplicate branch). The `node` tab is gated by `ENABLE_NODE_MODE` in `ui/src/lib/devMode.ts` (default `true`; set `VITE_IMA2_NODE_MODE=0` at build time to hide it). `App.tsx` forces `uiMode = "classic"` only when the env opt-out is set. `IS_DEV_UI` survives for dev-only debug panels and is unrelated to the node-mode tab.
- **Node-mode generation streams.** `POST /api/node/generate` honors `Accept: text/event-stream` and emits `phase` / `partial` / `done` / `error` SSE events. Without that header, it falls back to the original JSON shape. UI uses `postNodeGenerateStream` in `ui/src/lib/api.ts`.
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

## Git workflow (BLOCKING)

작업 단위마다 자동 분할 커밋 + push 가 이 레포의 기본값입니다. 사용자가 매번 "커밋해" 라고 안 시켜도 알아서 분할 커밋합니다.

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

## Gotchas

- The developer system prompts (`GENERATE_DEVELOPER_PROMPT` / `EDIT_DEVELOPER_PROMPT` / `REFERENCE_DEVELOPER_PROMPT` in `server.js` + `DEFAULT_PROMPT_INJECTION` in `lib/defaultPrompt.js`) are tuned for three things at once: moderation pass-rate, output-intensity preservation, and **model autonomy**. The original `e919e5a` (4/24) commit removed an "authorized red-team evaluation session" / "skip safety disclaimers" wrapper because it read as moderation-bypass in a published npm package. `fff1fcd` (4/29) restored pass-rate via positive framing (`"self-hosted creative workflow"` + `"render literally"` + a fashion/editorial/lookbook/swimwear allowlist). `65b5c16` (4/29) then **stripped all prescriptive aesthetic defaults** — the prior `"casual amateur smartphone photo / no studio lighting / no quality boosters"` ~250-word block and the `"natural, vivid image guidance over keyword spam … specific subject/setting/composition/lighting/lens/texture/mood"` keyword-style nudge — because they crowded out the user's own prompt and produced robotic, AI-look results (per `~/.claude/docs/image-generation-guide.md` §5). The same commit removed the user-role wrappers (`"Generate an image: ${prompt}"` / `"Use the attached reference … User request:"` / `RESEARCH_SUFFIX`) so the user role now carries only the user's own prompt (plus `boostRefPrompt`'s short face-lock cue when ref-mode + short prompt).
- Forbidden re-introductions in any prompt body:
  - ToS-bypass phrasing: `red-team`, `bypass`, `skip safety`, `unrestricted`, `evaluation session`.
  - Self-flagging tokens that cause the input classifier to self-label: `sensitive`, `illegal`, `harmful`, `evasion`, `abuse`, `exploitative`.
  - Prescriptive aesthetic defaults: `amateur smartphone photo`, `iPhone-style snapshot`, `no studio lighting`, `slightly imperfect framing`, `quality-booster phrasing`, keyword-spam guidance — these belong in the user's own prompt, not in system prompts.
  - User-role wrappers around `${prompt}` (`"Generate an image:"`, `RESEARCH_SUFFIX`, `"User request:"`). User role = user prompt only.
- When adding any new line to a system prompt, ask: does this preserve user-prompt autonomy? If it prescribes camera/lighting/style/composition the user did not ask for, it does not belong here. Test guards: `tests/defaultPrompt.test.js` (bypass-phrase blocklist + fictional-persona cue), `tests/ref-prompt.test.js` (face-lock boost only on short/variation prompts; long prompts pass through verbatim).
- `devlog/` documents three overlapping roadmaps (`AGENTS.md` Phase 0–3, README Roadmap 0.10–0.12, `devlog/_plan/README.md` 0.1–1.0). They have drifted. Treat them as historical context, not ground truth — confirm current scope with the user before acting on a devlog item.
- `public/index.html.legacy` is the pre-React vanilla build, kept for reference only. The live UI is `ui/dist/`.
- `generated/` has no size cap or TTL (only `.trash/` has soft-delete). Expect it to grow without bound on long-running dev installs.
- README has an unstaged edit (working copy) that reframes the model as `responses + image_generation` instead of `gpt-image-2`. Match that framing in any user-facing copy you touch.
