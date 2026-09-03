# ima2-gen — AI Context

## What This Project Does
GPT Image 2 (gpt-image-2) 이미지 생성기 CLI + 웹 UI
- OAuth (ChatGPT 계정) 또는 API Key 인증 지원
- 텍스트→이미지, 이미지→이미지(편집) 생성
- 병렬 생성 (최대 8장)

## Git Source Of Truth

- 운영 서비스는 asrock `/home/ko/apps/ima2-gen`에서 실행되지만, source of truth는 GitHub `ree9622/ima2-gen`의 `main`이다.
- **자동 운영 반영 (2026-07-31 ko 확정)**: ima2-gen에서 요청받은 작업은 검증 후 커밋·push·PR에 멈추지 않고, origin `main` 병합 → asrock 운영 checkout 동기화 → 서비스 재시작 → health와 실제 사용자 화면 검증까지 자동으로 완료한다. 사용자가 이번 작업은 배포하지 말라고 명시했거나 검증 실패·안전 차단이 있을 때만 운영 반영 전에 멈춘다.
- 운영 서버에서 직접 수정했거나 dirty checkout을 발견하면 완료 보고하지 않는다. clean branch로 source 변경분을 회수하고 commit/push/PR/merge 후 운영 checkout을 merge commit에 맞춘다.
- 완료 기준: 운영 서버에서 `git status --short`가 source 기준 clean이고 `git log -1 --oneline`이 원격 main commit을 가리켜야 한다.
- `generated/`, `logs/`, `backups/`, `node_modules/`, `ui/dist/`, `*.bak*`, `.env*`, runtime DB/data는 source가 아니므로 커밋하지 않는다.
- `.git` 없는 운영 디렉터리를 발견하면 신규 private repo 또는 기존 repo 연결을 먼저 만든 뒤 작업한다.

## Tech Stack
- Runtime: Node.js >=18 (ES Module)
- Server: Express 5
- API Client: OpenAI SDK v5
- OAuth: openai-oauth (ChatGPT 세션 프록시)
- OAuth liveness는 구현별로 다르다: 로컬 `openai-oauth` v2는 `/health`, 운영 `ima2-router`는 `/admin/`을 제공한다. 상태 확인은 이 순서로 폴백하고, 계정 busy 시 503일 수 있는 `/v1/models`를 오프라인 판정에 쓰지 않는다.
- Frontend: Vanilla HTML/CSS/JS

## Project Structure
```
image_gen/
├── bin/ima2.js           # CLI 진입점
├── server.js             # Express 서버 (이미지 생성/편집 API)
├── public/index.html     # 웹 UI
├── devlog/               # 개발 로드맵 및 계획
│   ├── _plan/README.md   # 활성 계획
│   ├── _fin/             # 완료된 작업
│   ├── phase-0/          # README + CLI 확장 (완료)
│   ├── phase-1/          # 코드 품질/구조 개선
│   ├── phase-2/          # 기능/안정성 개선
│   └── phase-3/          # 성능/확장성
├── tests/                # 테스트
│   ├── bin.test.js
│   └── server.test.js
└── package.json
```

## Devlog Phase Roadmap
- **Phase 0** ✅: README 보강, CLI 확장 (status, doctor, open, --version, --help)
- **Phase 1**: server.js 모듈 분리 (<200라인), 설정 외부화, 에러 처리 표준화
- **Phase 2**: 입력 검증, 로깅 시스템, 재시도/회복 메커니즘
- **Phase 3**: 캐싱, 레이트 리미팅, 모니터링 (/health), 배치 처리

## 실패 기록 (활동 로그 ≠ 실패 레코드)
- `localStorage["ima2.inFlight"]`의 활동 로그 행에는 프롬프트와 에러 문구만 있다. 첨부 이미지로 그대로 재시도하거나 실패 원인을 보여주려면 **서버 sidecar**(`generated/.failed/*.json`)를 `GET /api/generation-log/failed/by-request/:requestId`로 조회해야 한다(`mapFailedLogItem`).
- `retryActivity`는 그 조회가 성공하면 `retryFromLog`에 위임한다 → `generated/.refs`의 원본 첨부·품질·사이즈·시스템 프롬프트 복원. store 상태를 다시 읽는 방식으로 "고치지" 말 것(첨부를 잃어버린 주체가 store다).
- Responses 스트림이 이미지 없이 끝나면 `attachStreamDiagnostics()`가 `refusalText` / 모델이 도구 대신 낸 `text` / `reasoningSummary` / `eventTypeCounts` / 부분 `usage`를 에러에 붙인다. 이게 attempt 로그 → 실패 sidecar → UI `AttemptDiagnostics`로 흐른다. 새 empty/throw 경로를 추가하면 같이 붙여야 한다. 안 붙이면 정책 거절과 업스트림 장애를 구분할 수 없다.

## 프롬프트 스택 (2층, 층 = 파일)
- **끌 수 없는 층** `lib/developerPrompts.js` — `OUTPUT_CONTRACT`(image_generation 도구가 유일한 출력 채널, 산문 거절 금지), `SHEET_CONTRACT`(대괄호 카테고리 시트 읽는 법, `[자유]`는 매 렌더마다 다르게, 충돌 시 per-shot 지정 우선), 모드별 wrapper 3종.
- **끌 수 있는 층** `lib/defaultPrompt.js` `DEFAULT_PROMPT_INJECTION` — 콘텐츠 재량(브리프 그대로 렌더, 의도 판단, 장면 allowlist, 한국 기본 로케일). 좌측 패널에서 편집·OFF 가능. 클라이언트 사본 `ui/src/lib/defaultSystemPrompt.ts`와 **1:1 동기 의무**(테스트로 강제).
- **경계 규칙(BLOCKING)**: 출력 형식·브리프 해석 = wrapper, 콘텐츠 재량 = 시스템 프롬프트. npm 공개 배포 패키지이므로 끌 수 없는 층에 정책 재량을 넣지 않는다.
- **근거(2026-07-30 실측)**: 기본 프롬프트 ON 실패율 25.3%, OFF 63.3%. `EMPTY_RESPONSE` 55건 중 39건이 OFF이며 실체는 모델의 산문 거절이었다. 계약이 끌 수 있는 층에만 있던 것이 원인. 가드는 `tests/developer-prompts.test.js`.
- **default 변경 시**: 이전 텍스트를 `LEGACY_…`로 남기고 `useAppStore` migrate에서 정확히 일치할 때만 승격(persist version 증가). 없으면 기존 탭이 옛 default를 영구히 붙든다.

## 외부 근거 (OpenAI 공식, 2026-07-30 확인 — 재조사 불필요)
- 모델 ID는 `lib/models.js` 한 곳에서 관리한다. `IMAGE_MODEL`(기본 `gpt-5.5`, env `IMA2_RESPONSES_MODEL`)은 `image_generation` 도구를 부르는 오케스트레이터, `TEXT_MODEL`(기본 `gpt-5.6-sol`, env `IMA2_TEXT_MODEL`)은 도구를 안 쓰는 텍스트 보조(다듬기 `lib/enhance.js`, safety-retry rewrite `lib/llmRewrite.js`)다.
- **`IMAGE_MODEL`을 5.6으로 올리지 말 것.** OAuth 백엔드가 `gpt-5.6-sol/-terra/-luna`를 `/v1/models`에 노출하고 텍스트 응답도 정상이지만, 셋 다 `image_generation` 도구를 조용히 떨어뜨려 `Tool choice 'required' must be specified with 'tools' parameter`로 실패한다(2026-08-03 라이브 프록시 실측, ima2-router는 `tools`를 건드리지 않으므로 upstream 제약). 증상은 전건 `UPSTREAM_EMPTY`라 모델을 가리키지 않는다. `tests/models.test.js`가 이 핀을 강제한다.
- `input_fidelity`는 gpt-image-1.5/1/1-mini 전용. gpt-image-2가 안 받는 이유는 미지원이 아니라 **입력 이미지를 이미 자동으로 high fidelity로 처리하기 때문**이다. 우리 OAuth 경로(`gpt-image-2-codex`)의 400은 정상이며, 얼굴 유사도를 이 파라미터로 올리려는 시도는 근거가 없다.
- 프롬프트 순서 권장: 배경/장면 → 주체 → 핵심 디테일 → 제약. 정체성 보존은 `"Change only X, keep everything else the same"` + preserve 목록을 **편집마다 재기재**.
- `/api/edit`는 레퍼런스 생성용 `hasRefs` 안전 우회 문맥을 강제하지 않는다. 빈 응답 재시도에 `fashion BTS` 같은 장면 문구가 붙으면 사용자가 요청하지 않은 촬영장으로 재구성된다. 마스크 편집은 `MASKED_EDIT_CONTRACT`를 포함하고, 최종 결과에 `preserveOutsideMask`를 적용하며, 합성 전 partial 이미지는 노출하지 않는다.
- 레퍼런스 여러 장은 인덱스·역할로 지목(`"Image 1: … Image 2: style reference"`). 우리 UI엔 ref별 역할 지정이 없다.
- `8k`/`masterpiece`/`best quality` 류 키워드 스팸은 읽히지 않는다 → `lib/enhance.js` `[퀄리티]` 기본값에서 `8k` 제거(비율만).
- 1024² 단가: gpt-image-2 high $0.211 / medium $0.053, gpt-image-1.5 high $0.133 / medium $0.034.

## Conventions
- ES Module only (import/export)
- File length < 500 lines (split if exceeded)
- Function length < 50 lines
- try/catch mandatory for all async operations
- Config values in config.js or .env, never hardcode
- macOS/zsh에서 원격 배포 명령을 `ssh asrock "...$(command)..."`처럼 큰따옴표로 감싸지 않는다. `$()`가 로컬에서 먼저 실행돼 원격 preflight가 깨진다. 여러 줄 배포는 `ssh asrock 'bash -se' <<'REMOTE'` 형태의 quoted heredoc을 쓰고, 성공 판정은 원격 `systemctl`·SHA·health 출력으로 확인한다.

## Test Command
```bash
npm test   # node --test tests/**/*.test.js
```

## Heartbeat
- 20분마다 devlog/_plan 점검 및 다음 작업 제안
- 완료된 phase는 _fin/으로 이동 (YYMMDD_ prefix)
