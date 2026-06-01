---
created: 2026-05-19
parent: 00_overview.md
phase: qa
---

# Verification & QA Checklist

## 빌드/정적 검증 (자동)

- [ ] `npx tsc --noEmit` — 타입체크 통과
- [ ] `npx vite build` — 빌드 성공
- [ ] 기존 테스트 전수 통과 (756+)

## Contract 테스트 추가

### NEW — `tests/slash-command-menu-contract.test.ts`

| 테스트 ID | 설명 | 검증 내용 |
|---|---|---|
| SC-01 | 전체 커맨드 표시 | `filterCommands("")` → 5개 (question, variants, generate, parallelism, help) |
| SC-02 | prefix 필터링 | `filterCommands("q")` → `[question]` only |
| SC-03 | 복수 매치 | `filterCommands("v")` → `[variants]` (v alias) |
| SC-04 | alias 매칭 | `filterCommands("gen")` → `[generate]` |
| SC-05 | 매치 없음 | `filterCommands("xyz")` → `[]` |
| SC-06 | 대소문자 무시 | `filterCommands("Q")` → `[question]` |

## Browser QA (cli-jaw browser / 수동)

### 사전 조건
- `cli-jaw browser start --agent` 또는 headed Chrome 실행
- dev server: `cd ui && npm run dev` → `http://localhost:5173`
- Agent 모드 진입 (모드 스위치 토글)

### QA 시나리오

#### BQ-01: 메뉴 표시/숨김

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | textarea에 포커스 | 메뉴 없음 |
| 2 | `/` 입력 | dropup 메뉴 표시, 5개 항목, textarea 위에 위치 |
| 3 | 메뉴 위치 확인 | textarea 상단에 floating (아래가 아님) |
| 4 | `q` 추가 입력 (`/q`) | 메뉴 필터링 → `/question`만 표시 |
| 5 | Backspace로 `q` 삭제 → `/` | 5개 전부 다시 표시 |
| 6 | Backspace로 `/` 삭제 | 메뉴 닫힘 |

**검증 방법 (browser)**:
```bash
cli-jaw browser snapshot --interactive
# textarea ref 찾아서 클릭
cli-jaw browser type <ref> "/"
cli-jaw browser snapshot --interactive
# .slash-command-menu 존재 확인 + 5개 항목 확인
cli-jaw browser type <ref> "q"
cli-jaw browser snapshot --interactive
# 1개 항목만 남았는지 확인
```

#### BQ-02: Tab 자동완성

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | `/` 입력 | 메뉴 표시, 첫 항목(question) 하이라이트 |
| 2 | Tab 키 | textarea → `/question ` (후행 공백), 메뉴 닫힘 |
| 3 | `/v` 입력 | 메뉴 표시, `/variants` 하이라이트 |
| 4 | Tab 키 | textarea → `/variants `, 메뉴 닫힘 |

**검증 방법**:
```bash
cli-jaw browser type <ref> "/"
# Tab 키 전송
cli-jaw browser snapshot --interactive
# textarea value = "/question " 확인
```

#### BQ-03: 화살표 키 탐색

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | `/` 입력 | 첫 항목 하이라이트 |
| 2 | ↓ 키 | 두 번째 항목(variants) 하이라이트 |
| 3 | ↓ 키 × 3 | 다섯 번째(help) 하이라이트 |
| 4 | ↓ 키 | 첫 항목으로 순환 |
| 5 | ↑ 키 | 다섯 번째로 순환 |
| 6 | Enter | 하이라이트된 항목 선택 → textarea 채움 |

#### BQ-04: Escape 닫기

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | `/q` 입력 | 메뉴 표시 |
| 2 | Escape | 메뉴 닫힘, **draft `/q` 보존** (WAI-ARIA APG: textbox 비우지 않음) |
| 3 | `q` → `v`로 교체하여 `/v` | 메뉴 재표시 (variants 필터링) — `slashQuery` 변경으로 `menuDismissed` 자동 해제 검증 |

#### BQ-05: 클릭 선택

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | `/` 입력 | 메뉴 표시 |
| 2 | `/generate` 항목 클릭 | textarea → `/generate `, 메뉴 닫힘 |
| 3 | textarea 포커스 유지 확인 | 커서가 textarea 안에 있어야 함 |

**검증 방법**:
```bash
cli-jaw browser snapshot --interactive
# .slash-command-menu__item ref 찾아서 클릭
cli-jaw browser click <item-ref>
cli-jaw browser snapshot --interactive
# textarea value 확인
```

#### BQ-06: 기존 전송 동작 보존

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | `/variants 3 cyberpunk cat` 입력 | 메뉴 없음 (공백 이후이므로) |
| 2 | Cmd+Enter | 메시지 전송 (기존 동작과 동일) |
| 3 | textarea 비워짐 확인 | draft = "" |

#### BQ-07: 일반 메시지 무영향

| 단계 | 입력 | 기대 결과 |
|---|---|---|
| 1 | `hello world` 입력 | 메뉴 없음 |
| 2 | Tab 키 | 기본 브라우저 동작 (포커스 이동) |
| 3 | Cmd+Enter | 메시지 전송 |

#### BQ-08: 레이아웃 비침범

| 항목 | 확인 |
|---|---|
| composer 높이 | 메뉴 열림/닫힘에 따라 변하지 않음 |
| actions bar 위치 | 동일 |
| 메뉴 z-index | 다른 UI 요소 위에 올바르게 표시 |
| 다크 모드 | `var(--surface)`, `var(--border)` 등 CSS 변수 적용 확인 |

## 접근성 (a11y) 확인

- [ ] `role="listbox"` + `role="option"` 설정
- [ ] `aria-activedescendant` 연결
- [ ] `aria-label` 설정 (`t("agent.slashCommands")` 재사용)
- [ ] 스크린 리더에서 항목 이동 알림

## Regression 체크

- [ ] 기존 슬래시 커맨드 서버 파싱 영향 없음 (`agentCommandParser.ts` 미수정)
- [ ] 일반 텍스트 메시지 전송 정상
- [ ] insertedPrompt 기능 정상
- [ ] 웹 검색 토글 정상
- [ ] 첨부 버튼 정상
