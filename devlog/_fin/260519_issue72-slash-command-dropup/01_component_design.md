---
created: 2026-05-19
updated: 2026-05-19
parent: 00_overview.md
phase: design
audit: "rev2 — P0 i18n/ARIA/Escape 수정, P1 CSS position/shadow/z-index 수정"
---

# Component Design

## 커맨드 데이터 구조

서버 `agentCommandParser.ts`의 `COMMAND_ALIASES`를 UI에서도 사용할 수 있도록
프론트엔드에 커맨드 정의 배열을 둔다. description은 i18n key로 참조.

### NEW — `ui/src/components/agent/slashCommands.ts`

```ts
import type { AgentSlashCommandName } from "../../../lib/agentTypes.js";

export type SlashCommandDef = {
  name: AgentSlashCommandName;  // canonical name (서버 파서와 타입 공유)
  display: string;              // 표시용: "/question", "/variants <N>", ...
  aliases: string[];            // prefix 매칭용: ["question", "ask", "q"]
  descriptionKey: string;       // i18n key (t() 호출용)
  hasValue?: boolean;           // <N> 인자 유무
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: "question",
    display: "/question",
    aliases: ["question", "ask", "q"],
    descriptionKey: "agent.slash.question.desc",
  },
  {
    name: "variants",
    display: "/variants <N>",
    aliases: ["variants", "variant", "v", "n"],
    descriptionKey: "agent.slash.variants.desc",
    hasValue: true,
  },
  {
    name: "generate",
    display: "/generate <N>",
    aliases: ["generate", "gen", "g"],
    descriptionKey: "agent.slash.generate.desc",
    hasValue: true,
  },
  {
    name: "parallelism",
    display: "/parallelism <N>",
    aliases: ["parallelism", "parallel", "p"],
    descriptionKey: "agent.slash.parallelism.desc",
    hasValue: true,
  },
  {
    name: "help",
    display: "/help",
    aliases: ["help", "h"],
    descriptionKey: "agent.slash.help.desc",
  },
];

export function filterCommands(query: string): SlashCommandDef[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) =>
    cmd.aliases.some((alias) => alias.startsWith(q))
  );
}
```

### i18n 키 추가 (ko.json / en.json)

```json
// ko.json — agent 섹션 추가
"agent.slash.question.desc": "이미지 생성 없이 질문",
"agent.slash.variants.desc": "N개 이미지 변형 생성 (1-8)",
"agent.slash.generate.desc": "bounded fanout 생성 (1-8)",
"agent.slash.parallelism.desc": "동시 실행 제한",
"agent.slash.help.desc": "사용 가능한 명령어 도움말"

// en.json — agent 섹션 추가
"agent.slash.question.desc": "Ask a question without generating images",
"agent.slash.variants.desc": "Generate N image variants (1-8)",
"agent.slash.generate.desc": "Bounded fanout generation (1-8)",
"agent.slash.parallelism.desc": "Limit concurrent tool calls",
"agent.slash.help.desc": "Show available commands"
```

## 컴포넌트 구조

```
AgentComposer (MODIFY)
├── SlashCommandMenu (NEW) — dropup floating menu
│   └── li[role="option"] × N — 개별 항목
└── textarea[role="combobox"]
```

### NEW — `ui/src/components/agent/SlashCommandMenu.tsx`

```tsx
import { useI18n } from "../../i18n";
import { filterCommands, type SlashCommandDef } from "./slashCommands";

type Props = {
  listboxId: string;           // aria-controls 타깃 (useId()로 생성)
  query: string;               // "/" 뒤의 입력 (예: "q", "var")
  highlightIndex: number;      // 현재 하이라이트 위치
  onSelect: (cmd: SlashCommandDef) => void;
  onHighlightChange: (index: number) => void;
};

export function SlashCommandMenu({ listboxId, query, highlightIndex, onSelect, onHighlightChange }: Props) {
  const { t } = useI18n();
  const filtered = filterCommands(query);
  if (filtered.length === 0) return null;

  return (
    <ul
      id={listboxId}
      className="slash-command-menu"
      role="listbox"
      aria-label={t("agent.slashCommands")}
    >
      {filtered.map((cmd, i) => (
        <li
          key={cmd.name}
          id={`${listboxId}-opt-${i}`}
          role="option"
          aria-selected={i === highlightIndex}
          className={`slash-command-menu__item${i === highlightIndex ? " is-highlighted" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onHighlightChange(i)}
        >
          <span className="slash-command-menu__name">{cmd.display}</span>
          <span className="slash-command-menu__desc">{t(cmd.descriptionKey)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- `onMouseDown` → `preventDefault()` — 클릭 시 textarea blur 방지
- `onMouseEnter` → highlight 이동 (마우스 호버 추적)

### MODIFY — `AgentComposer.tsx`

기존 정적 `agent-composer__commands` div 제거. 대신:

```tsx
import { useId, useEffect, useRef, useState } from "react";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { filterCommands, type SlashCommandDef } from "./slashCommands";

// 새로 추가할 상태
const [highlightIndex, setHighlightIndex] = useState(0);
const [menuDismissed, setMenuDismissed] = useState(false);
const textareaRef = useRef<HTMLTextAreaElement>(null);
const listboxId = useId();

// "/" 감지 + query 추출
const slashMatch = draft.trimStart().match(/^\/([a-z]*)$/i);
const showMenu = slashMatch !== null && !menuDismissed;
const slashQuery = slashMatch?.[1] ?? "";
const filtered = filterCommands(slashQuery);

// query 변경 시 highlight 리셋 + menuDismissed 해제
useEffect(() => {
  setHighlightIndex(0);
  setMenuDismissed(false);
}, [slashQuery]);

// 현재 active option id
const activeOptionId = showMenu && filtered.length > 0
  ? `${listboxId}-opt-${highlightIndex}`
  : undefined;

// 선택 핸들러
const handleSelect = (cmd: SlashCommandDef) => {
  const base = `/${cmd.name} `;
  setDraft(base);
  textareaRef.current?.focus();
};
```

렌더:
```tsx
<div className="agent-composer">
  {showMenu && filtered.length > 0 && (
    <SlashCommandMenu
      listboxId={listboxId}
      query={slashQuery}
      highlightIndex={highlightIndex}
      onSelect={handleSelect}
      onHighlightChange={setHighlightIndex}
    />
  )}
  <textarea
    ref={textareaRef}
    value={draft}
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={showMenu && filtered.length > 0}
    aria-controls={listboxId}
    aria-activedescendant={activeOptionId}
    autoCapitalize="off"
    autoCorrect="off"
    placeholder={t("agent.composerPlaceholder")}
    onChange={(event) => setDraft(event.target.value)}
    onKeyDown={...}
  />
  ...
</div>
```

## CSS 변경

### MODIFY — `agent-workspace-panels.css`

기존 `.agent-composer__commands` + `.agent-composer__commands span` 규칙 삭제.

`.agent-composer`에 `position: relative` 추가 (인라인 style 아닌 CSS 규칙으로):

```css
.agent-composer {
  position: relative;   /* slash-command-menu absolute anchor */
  display: grid;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
```

### NEW — `.slash-command-menu` 스타일

```css
.slash-command-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 -8px 20px var(--shadow-strong, rgba(0,0,0,.4));
  z-index: 20;
}

.slash-command-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;          /* 모바일 터치 영역 충족 */
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.slash-command-menu__item:hover,
.slash-command-menu__item.is-highlighted {
  background: var(--control-bg);
}

.slash-command-menu__name {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--text);
}

.slash-command-menu__desc {
  color: var(--text-dim);
  font-size: 12px;
}
```

## 파일 변경 요약

| 파일 | 작업 | 내용 |
|---|---|---|
| `ui/src/components/agent/slashCommands.ts` | NEW | 커맨드 정의 배열 (i18n key 참조) + `filterCommands()` |
| `ui/src/components/agent/SlashCommandMenu.tsx` | NEW | Dropup 메뉴 컴포넌트 (ARIA listbox + option) |
| `ui/src/components/agent/AgentComposer.tsx` | MODIFY | 정적 pill 제거 → `SlashCommandMenu` 통합, ARIA combobox 속성, `useId()`, `menuDismissed` state |
| `ui/src/styles/agent-workspace-panels.css` | MODIFY | `.agent-composer` position:relative 추가, `.agent-composer__commands` 제거 → `.slash-command-menu` 추가 |
| `ui/src/i18n/ko.json` | MODIFY | `agent.slash.*.desc` 5개 키 추가 |
| `ui/src/i18n/en.json` | MODIFY | `agent.slash.*.desc` 5개 키 추가 |
