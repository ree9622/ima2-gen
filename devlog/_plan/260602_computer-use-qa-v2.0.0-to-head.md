---
created: 2026-06-02
updated: 2026-06-02
tags: [ima2-gen, qa, oauth, computer-use, release-audit]
---

# Computer Use QA Plan — v2.0.0..HEAD

## Scope

- Baseline: `v2.0.0`
- Current commit head at plan start: `81ba632 feat: add Grok video model picker (V / V1.5) to video controls`
- Commit range: 47 commits from `v2.0.0..HEAD`
- Working-tree lane: recursive thumbnail backfill, history video fallback rendering, video drag-to-reference, Windows path handling, and related health-test port changes.
- Primary risk surfaces: OAuth generation, provider switching, key/credential handling, Grok video model selection, Gemini/Vertex routing, history/media thumbnails, CLI parity, and package/build output.

## Release Delta Map

| Lane | Commit/files | Risk | Required evidence |
|---|---|---:|---|
| GPT OAuth image generation | `routes/generate.ts`, `lib/responsesFallback.ts`, OAuth retry changes | High | Actual GPT OAuth generation produces a saved image; no secret/log leakage; retry preserves developer prompt. |
| Grok OAuth image generation | Grok provider/model/size picker changes | High | Actual Grok image generation produces a saved image; planner/search/final logs are sane and redacted. |
| Grok OAuth video generation | video model picker, `grok-imagine-video` and `grok-imagine-video-1.5-preview` support | High | UI can select V/V1.5; actual shortest viable video generation saves MP4 and sidecar. |
| Gemini OAuth via agy | `lib/agyImageAdapter.ts`, provider plumbing, CLI parity | High | Actual agy/Gemini OAuth generation produces an image or reports a precise external-auth blocker. |
| Gemini API/Vertex | key routes, `geminiAuthMode`, Vertex auth, cost/model controls | High | API/Vertex mode selection survives reload; direct/Vertex payloads are validated by tests and UI. |
| OAuth account switching | `routes/auth.ts`, `QuotaCard.tsx` switch UI | High | Codex/Grok device-code sessions create user code + verification URL; copy/open-again UI works; abandoned Codex child is reaped. |
| Thumbnail/history media | `imageThumb`, `videoThumb`, `historyList`, working-tree `thumbBackfill` | Medium | Recursive backfill handles top-level and nested media, skips existing thumbs, does not traverse trash, invalidates index only when needed. |
| CLI parity | `bin/commands/{gen,edit,multimode,node}.ts`, `capabilities` | Medium | Help/contract tests expose new providers and video models; live server CLI smoke passes. |
| UI layout | provider/model controls, Gemini/Grok pickers, video model picker, history fallback videos | Medium | Computer Use screenshot confirms no clipped text, correct active states, and generation surfaces remain usable. |
| Security hardening | atomic credential writes, key headers, token/env scrub, sharp input cap | High | Static tests pass; secret scans/searches show no new raw-key logging or query-string key usage. |

## Computer Use QA Matrix

Every UI step starts with `get_app_state(app="Google Chrome")` and re-reads state after navigation, modal open/close, or ambiguous click results.

| ID | UI flow | Steps | Pass criteria |
|---|---|---|---|
| CU-01 | App boot and provider panel | Open local app URL, verify Classic mode, right controls, provider selector, model selector. | No blank shell; provider/model buttons are visible and text is not clipped. |
| CU-02 | Grok image controls | Select Grok image provider, toggle Grok/Grok+ model, 1K/2K resolution, aspect ratio. | Active state follows selection; size shown as `grok:<aspect>:<resolution>` through request path or store. |
| CU-03 | Grok video controls | Toggle video mode, verify new right-panel model row: `Grok V / Fast` and `Grok V1.5 / Preview`. | Buttons appear to the right-side controls with image-picker styling; active state switches without layout shift. |
| CU-04 | Gemini controls | Select agy/Gemini API models and Gemini API aspect/resolution controls. | Gemini/Gemini API does not trigger GPT pixel-limit modal for 4K/non-square choices. |
| CU-05 | Switch account modal | Use GPT OAuth and Grok Switch Account controls from settings/quota. | Device code, verification URL, `Open tab again`, and `Copy link` are visible; polling state is stable. |
| CU-06 | Generation smoke from UI | Run one low-risk prompt per OAuth provider where credentials exist. | Result tile appears, history updates, generated asset has sidecar/metadata. |
| CU-07 | History thumbnails | Inspect sidebar/history after image/video generation and after backfill route. | Image thumbs load; video thumb loads when present; video element fallback appears when thumb is missing. |
| CU-08 | Reload/persistence | Refresh app and verify selected provider/model defaults and new history. | No F5 refresh regression; selected defaults and generated history persist. |

## Non-UI Verification Matrix

| ID | Command | Expected |
|---|---|---|
| QA-01 | `npm test` | All node contract/regression tests pass. |
| QA-02 | `npm run typecheck` | Server/app TypeScript passes. |
| QA-03 | `cd ui && npx tsc -b --noEmit` | Frontend TypeScript passes. |
| QA-04 | `npm run ui:build` | Vite production build passes. |
| QA-05 | `npm run build:server && npm run build:cli` | Emitted JS matches TS sources for package. |
| QA-06 | `npm audit --audit-level=high` | No high/critical dependency issues, or documented accepted risk. |
| QA-07 | `rg` secret checks | No API keys in URLs/log output; no raw token logging in changed auth/provider code. |
| QA-08 | focused route probes | `/api/providers`, `/api/quota`, `/api/capabilities`, `/api/auth/switch`, `/api/history/backfill-thumbnails` return expected shapes. |

## Actual OAuth Generation Tests

Run from the local server with the shortest prompt and lowest viable output size. Record the exact provider, command/UI route, saved filename, and artifact metadata.

| Provider | Test | Success | Blocker handling |
|---|---|---|---|
| GPT OAuth / Codex | Classic image generation with provider `oauth`, no refs, one image. | PNG/JPEG saved under configured generated dir; history row provider is `oauth`. | If Codex OAuth is absent/expired, verify switch device-code creation and report the auth precondition exactly. |
| Grok OAuth image | Classic image generation with provider `grok`, 1K, 1:1. | JPEG saved; Grok planner/search/final phases complete; no token leakage. | If progrok auth absent/expired, verify Grok device-code creation and report the auth precondition exactly. |
| Grok OAuth video | Video generation with provider `grok`, model V or V1.5, 1s/480p where supported. | MP4 + sidecar saved; history thumbnail/backfill lane handles it. | If subscription/quota blocks video, record upstream error and still verify model UI + route request payload. |
| Gemini OAuth / agy | Classic image generation with provider `agy`, one image. | JPEG saved; agy output path is parsed safely and copied to generated dir. | If `agy`/Gemini OAuth is unavailable, report the exact missing binary/auth condition and verify no silent fallback. |

## Patch Rules

- Keep commits atomic:
  - QA plan/documentation.
  - Focused code fix per finding.
  - Test/build emitted output if required by package conventions.
- Do not revert unrelated dirty work.
- If a finding touches current working-tree edits, preserve the intent and patch in place.
- After every patch: rerun the smallest relevant test, then the release gate.

## Completion Gate

The goal is complete only when:

- The plan document is committed.
- Static, unit/contract, type, UI build, and security checks pass or have an exact external blocker.
- Computer Use UI transcript covers CU-01 through CU-08 or documents an exact UI/auth precondition.
- All available OAuth providers have actual generation artifacts, not just mocked tests.
- Frontend/backend verification employees report no blockers after patches.
- `main` is pushed to origin when the working tree is clean or remaining dirt is explicitly outside this QA scope.
