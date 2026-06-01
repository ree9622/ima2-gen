---
created: 2026-05-19
updated: 2026-05-19
parent: 00_overview.md
phase: design
audit: "rev2 — Escape 동작 수정 (draft 보존), Space 문서 정리, ARIA activedescendant 위치 수정"
---

# Keyboard Interaction Design

## 키 바인딩 매트릭스

메뉴가 열려있을 때 (`showMenu && filtered.length > 0`):

| 키 | 동작 | 비고 |
|---|---|---|
| `Tab` | 1순위(highlighted) 항목 자동완성 | `preventDefault()` 필수 — 기본 Tab 포커스 이동 방지 |
| `↓` (ArrowDown) | highlight 다음 항목으로 이동 | 마지막 → 처음으로 순환 |
| `↑` (ArrowUp) | highlight 이전 항목으로 이동 | 처음 → 마지막으로 순환 |
| `Enter` | highlighted 항목 선택 | `preventDefault()` — 줄바꿈 방지 |
| `Cmd+Enter` / `Ctrl+Enter` | 메시지 전송 (기존 동작) | 메뉴 무시, 전송 로직으로 통과 |
| `Escape` | **메뉴만 닫기** (draft 보존) | `setMenuDismissed(true)` — draft 절대 손대지 않음 |
| 일반 타이핑 | query 업데이트 → 필터링 | highlight 0으로 리셋, `menuDismissed` 해제 |
| `Space` | (별도 처리 불필요) | 정규식 `/^\/[a-z]*$/i`이 공백을 매치 안 해서 자동으로 메뉴 닫힘 |
| `Backspace` (draft → "") | 메뉴 닫힘 | "/" 자체가 삭제되면 `slashMatch === null` |

메뉴가 닫혀있을 때:

| 키 | 동작 |
|---|---|
| `Tab` | 기본 브라우저 동작 (포커스 이동) |
| `Cmd+Enter` / `Ctrl+Enter` | 전송 |
| 기타 | 기본 textarea 동작 |

## onKeyDown 로직 (AgentComposer.tsx)

```tsx
onKeyDown={(event) => {
  // 1. 전송: 항상 최우선
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
    return;
  }

  // 2. 메뉴 열려있을 때만
  if (showMenu && filtered.length > 0) {
    switch (event.key) {
      case "Tab": {
        event.preventDefault();
        handleSelect(filtered[highlightIndex]);
        return;
      }
      case "ArrowDown": {
        event.preventDefault();
        setHighlightIndex((i) => (i + 1) % filtered.length);
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      case "Enter": {
        event.preventDefault();
        handleSelect(filtered[highlightIndex]);
        return;
      }
      case "Escape": {
        event.preventDefault();
        setMenuDismissed(true);   // 메뉴만 닫고 draft는 보존
        return;
      }
    }
  }
}}
```

## Escape 동작 상세 (WAI-ARIA APG 준수)

WAI-ARIA APG Combobox 패턴 권고:
> "Escape: Closes the listbox if displayed. Optionally clears the textbox."

**구현 결정**: listbox만 닫고 textbox(draft) 보존.

```
사용자 시나리오:
1. "/q" 입력 → 메뉴 열림 (/question 표시)
2. 마음 바꿈 → Escape
3. 메뉴 닫힘, draft는 "/q" 유지
4. "q" 지우고 "v" 입력 → "/v" → 메뉴 다시 열림 (/variants 표시)
```

`menuDismissed` state:
- `true`: 메뉴 숨김 (slashMatch가 있어도)
- `false`: 정상 동작 (slashMatch 있으면 메뉴 표시)
- 리셋 조건: `slashQuery` 값 변경 시 자동 해제 (`useEffect` dependency)

## 자동완성 후 상태

선택 시:
1. `draft` → `"/variants "` (후행 공백 포함)
2. 메뉴 닫힘 (`slashMatch`가 `/variants `에 매칭 안 됨 — 공백 포함이므로)
3. `textareaRef.current?.focus()` — textarea 포커스 유지
4. 사용자는 바로 인자/프롬프트 입력 가능

## ARIA 포커스 관리

WAI-ARIA combobox 패턴에 따라 DOM focus는 항상 textarea에 유지.
보조 기술에는 `aria-activedescendant`로 현재 시각적 포커스 전달.

textarea 속성:
```tsx
<textarea
  ref={textareaRef}
  role="combobox"
  aria-autocomplete="list"
  aria-expanded={showMenu && filtered.length > 0}
  aria-controls={listboxId}
  aria-activedescendant={activeOptionId}
  ...
/>
```

- `role="combobox"`: textarea가 combobox 역할
- `aria-autocomplete="list"`: 입력에 따라 목록 필터링
- `aria-expanded`: 메뉴 표시 여부
- `aria-controls`: listbox 요소 id 참조
- `aria-activedescendant`: 현재 하이라이트된 option id 참조

listbox/option:
```tsx
<ul id={listboxId} role="listbox" aria-label={t("agent.slashCommands")}>
  <li id={`${listboxId}-opt-${i}`} role="option" aria-selected={i === highlightIndex}>
```

- `id`: `aria-activedescendant` 타깃 (useId() 기반 unique prefix)
- `aria-selected`: 현재 하이라이트 상태

## 메뉴 표시 조건 (정밀)

```
slashMatch = draft.trimStart().match(/^\/[a-z]*$/i)
showMenu = slashMatch !== null && !menuDismissed
```

이 정규식은:
- `/` → 매치 (전체 커맨드 표시)
- `/q` → 매치 (필터링)
- `/question ` → 매치 안 됨 (공백 이후 = 인자 입력 구간)
- `/question hello` → 매치 안 됨
- `hello /q` → 매치 안 됨 (맨 앞에 `/`가 아님)
- 빈 문자열 → 매치 안 됨
