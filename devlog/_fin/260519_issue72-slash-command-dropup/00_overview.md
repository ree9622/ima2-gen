---
created: 2026-05-19
status: plan
tags: [ima2-gen, agent-mode, slash-command, autocomplete, dropup, jawdev]
github: "#72"
---

# Slash Command Dropup Menu + Tab Autocomplete

## Why This Exists

현재 Agent Composer에서 `/` 입력 시 textarea 아래에 정적 pill 뱃지 4개가 나열된다.
클릭도 안 되고, 필터링도 없고, tab 자동완성도 없어서 사실상 장식에 가깝다.
composer 아래 공간을 불필요하게 차지하고 있어 입력 영역이 좁아 보인다.

**목표**: Discord/Slack 스타일의 dropup 자동완성 메뉴로 교체한다.

## Current State (AS-IS)

```
┌─────────────────────────────────────┐
│ /                                   │  ← textarea
│                                     │
└─────────────────────────────────────┘
  /question  /variants 3  /generate 4  /parallelism 2   ← 정적 pill (클릭 불가)
  [📎] [🌐] [전송]                                       ← actions bar
```

- `AgentComposer.tsx:16`: `draft.trimStart().startsWith("/")` → 정적 `<span>` 4개 렌더
- 상호작용 없음, 필터링 없음, 키보드 내비게이션 없음

## Target State (TO-BE)

```
  ┌─────────────────────────────────┐
  │ /question   질문 (생성 없이)     │  ← highlighted (Tab으로 선택)
  │ /variants   N개 변형 생성        │
  │ /generate   bounded fanout      │
  │ /parallelism 병렬 제한           │
  │ /help       도움말               │
  └─────────────────────────────────┘
┌─────────────────────────────────────┐
│ /q                                  │  ← textarea ("/q" 입력 → /question만 필터)
└─────────────────────────────────────┘
  [📎] [🌐] [전송]
```

- textarea 위에 floating dropup 메뉴
- 타이핑에 따라 실시간 prefix 필터링
- Tab: 1순위 항목 자동완성
- ↑↓: 항목 이동
- Enter: 선택 (Cmd+Enter: 전송과 구분)
- Escape: 메뉴 닫기
- 클릭: 선택

## Plan Documents

- `01_component_design.md` — 컴포넌트 구조 + 데이터 흐름
- `02_keyboard_interaction.md` — 키보드/포커스 로직 상세
- `03_verification_and_qa.md` — browser QA 체크리스트
