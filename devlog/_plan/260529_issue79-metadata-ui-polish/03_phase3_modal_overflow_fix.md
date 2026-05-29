---
created: 2026-05-29
status: plan
depends_on:
  - 00_overview.md
tags: [bug, modal, overflow, css, p1]
---

# Phase 3: 모델 선택 드롭다운 overflow 수정

## 확정된 원인 (Overview 정정)

Overview에서 `max-height: 280px` 부족이 원인이라고 했으나, **실제 원인은 다름**.

### 실제 원인 (검증 완료)

**ImageModelSelect 사이드바 드롭다운** (`ImageModelSelect.tsx:114-189`):

1. **컨테이너 구조**:
   - `.sidebar` (`index.css:561`) → `overflow: hidden`
   - `.sidebar__scroll` (`index.css:567`) → `overflow-y: auto`
   - `.logo-actions` → `.image-model-select--sidebar` → `position: relative`
   - `.image-model-select__menu` (`index.css:1684-1698`) → `position: absolute; top: calc(100% + 7px); z-index: 40`

2. **짤리는 이유**:
   - 드롭다운은 `position: absolute`로 부모 밖으로 나감
   - 하지만 상위 `.sidebar`에 `overflow: hidden`이 있음
   - **`overflow: hidden`은 z-index 무시** — absolute 자식이라도 잘림
   - 모델 목록이 길어지면 (GPT-5.5 Thinking, Pro, 5.4, Mini + reasoning 5단계) 드롭다운이 사이드바 경계 아래로 넘어감

3. **메뉴 자체에 `max-height` 없음** — 스크롤 불가능, 잘리면 그냥 잘림

**AgentModelSheet** (`AgentModelSheet.tsx:15-35`):
- `position: fixed; inset: 0; z-index: 70` → 전체 뷰포트 오버레이
- `.agent-model-sheet` → `max-height: min(70dvh, 520px); overflow-y: auto`
- **이건 정상**. overflow 문제 없음. 별도 수정 불필요.

### 결론

사이드바 `ImageModelSelect` 드롭다운만 수정 필요. AgentModelSheet는 정상.

## 수정 방안 비교

| 방안 | 장점 | 단점 |
|---|---|---|
| **A. Portal** — 메뉴를 `document.body`에 렌더 | 부모 overflow 완전 탈출 | React Portal 추가 필요, 위치 계산 |
| **B. max-height + scroll** — 메뉴에 `max-height` + `overflow-y: auto` | 최소 변경 | 여전히 잘릴 수 있음 (사이드바가 짧으면) |
| **C. overflow 변경** — `.sidebar`의 `overflow: hidden` → `overflow: visible` | 단순 | 사이드바 스크롤 동작에 영향 |

**권장: A + B 조합**
- 사이드바 variant에서 메뉴를 Portal로 `document.body`에 렌더
- 메뉴에 `max-height: min(400px, calc(100dvh - 80px)); overflow-y: auto` 추가 (안전망)
- 부모 `.sidebar`의 `overflow: hidden`은 건드리지 않음 (다른 콘텐츠 영향 우려)

## 수정 계획

### 1. Portal 렌더링 (`ImageModelSelect.tsx`)

**사이드바 variant에서 메뉴를 Portal로:**

```typescript
import { createPortal } from "react-dom";

const isSidebar = variant === "sidebar";              // ⚠️ prop은 variant: "settings"|"sidebar" (isSidebar 아님)
const triggerRef = useRef<HTMLButtonElement>(null);   // trigger는 <button> (:117-133)
const menuRef = useRef<HTMLDivElement>(null);         // outside-click에서 rootRef+menuRef 둘 다 체크
const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

// 위치 측정 + 사이드바/페이지 스크롤·리사이즈 시 닫기 (detach 방지 — audit F1)
useEffect(() => {
  if (!open || !isSidebar) return;
  const rect = triggerRef.current?.getBoundingClientRect();
  if (rect) setMenuPos({ top: rect.bottom + 7, right: window.innerWidth - rect.right });
  const close = () => setOpen(false);
  const scroller = document.querySelector(".sidebar__scroll");      // clipping 조상
  scroller?.addEventListener("scroll", close, { passive: true });
  window.addEventListener("scroll", close, { passive: true, capture: true });
  window.addEventListener("resize", close);
  return () => {
    scroller?.removeEventListener("scroll", close);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  };
}, [open, isSidebar]);

const menuElement = (
  <div
    ref={menuRef}
    className="image-model-select__menu"
    style={isSidebar ? {
      position: "fixed",
      top: menuPos.top,
      right: menuPos.right,
      zIndex: 160,                                    // ⚠️ mobile-app-bar 150 위 / compose-backdrop 170 아래 (audit F2)
      maxHeight: "min(400px, calc(100dvh - 80px))",
      overflowY: "auto",
    } : undefined}
  >
    {/* ...menu content... */}
  </div>
);

return (
  <>
    <button ref={triggerRef} onClick={toggle}>...</button>
    {open && (isSidebar ? createPortal(menuElement, document.body) : menuElement)}
  </>
);
```

### 2. CSS 추가 (`index.css`)

```diff
  .image-model-select__menu {
    position: absolute;
    top: calc(100% + 7px);
    right: 0;
    z-index: 40;
+   max-height: min(400px, calc(100dvh - 80px));
+   overflow-y: auto;
  }
```

### 3. 클릭 바깥 닫기 — Portal에서 깨짐 방지 (중요)

현재 outside-click 핸들러 (`ImageModelSelect.tsx:82-100`)는 `rootRef.current?.contains(target)`만 확인.
메뉴를 `document.body`로 Portal하면 **메뉴 클릭도 root 밖으로 판정**되어 pointerdown에서 닫힘 → click handler 실행 전 메뉴 소실.

**수정**: `menuRef`를 추가하고 outside-click에서 양쪽 확인:

```typescript
const menuRef = useRef<HTMLDivElement>(null);

// outside-click handler 수정
useEffect(() => {
  if (!open) return;
  const handlePointerDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (rootRef.current?.contains(target)) return;
    if (menuRef.current?.contains(target)) return;
    setOpen(false);
  };
  document.addEventListener("pointerdown", handlePointerDown);
  return () => document.removeEventListener("pointerdown", handlePointerDown);
}, [open]);

// Portal 메뉴에 ref 연결
const menuElement = (
  <div ref={menuRef} className="image-model-select__menu" ...>
    {/* ...menu content... */}
  </div>
);
```

⚠️ 실제 trigger는 `<button>` (`ImageModelSelect.tsx:117-133`), `triggerRef` 타입도 `HTMLButtonElement`로.

## Acceptance Criteria

1. 사이드바에서 모델 선택 드롭다운이 사이드바 경계 밖으로 잘리지 않음
2. 드롭다운이 화면 하단을 넘어가면 스크롤 가능
3. 드롭다운 바깥 클릭 시 닫힘
4. Agent Mode 모델 시트는 기존 동작 유지
5. 모바일/좁은 화면에서도 정상 동작

## Verification

```bash
cd ui && npx tsc -b --noEmit
cd ui && npm run build
npm test
```

+ 직원 Computer Use smoke: 사이드바에서 모델 드롭다운 열기 → 전체 목록 표시 확인
+ 모바일 뷰포트(375px)에서도 확인

---

## 🔍 검증 정정 (audit 2026-05-29, post-#78)

### CSS 줄 번호 — 전부 정확 (drift 없음)
`.sidebar` overflow:hidden = `index.css:561` ✅ / `.sidebar__scroll` overflow-y:auto = `:567` ✅ / `.image-model-select__menu` = `:1684-1698` ✅ (`max-width: min(280px, calc(100vw-24px))` @1692, **max-height 없음** ✅). `AgentModelSheet` 정상(position:fixed 오버레이) = 수정 불필요 ✅.

### ⚠️ 계획이 놓친 함정

1. **clipping 조상이 둘.** `.sidebar`(overflow:hidden)뿐 아니라 `.sidebar__scroll`(overflow-y:auto, `:567`)도 자름. Portal→`document.body`는 둘 다 탈출하므로 수정 방향 자체는 유효.
2. **`position:fixed` 포털 + 사이드바 독립 스크롤 = 트리거에서 detach.** 계획은 open 시 `getBoundingClientRect`를 한 번만 측정 → 사이드바 스크롤하면 메뉴가 고정 좌표에 붕 뜸. **스크롤 시 닫기 또는 좌표 재계산** 필요.
3. **프롭 이름 정정:** `isSidebar`(boolean) ❌ → 실제는 `variant: "settings" | "sidebar"`. trigger는 `<button>`(`:117-133`), outside-click은 `rootRef.current?.contains`(`:82-100`), `menuRef`·`createPortal` 아직 없음 → 둘 다 추가 필요.
4. **모바일.** 같은 `ImageModelSelect variant="sidebar"`가 `MobileAppBar`에서도 사용됨. `.mobile-app-bar`는 `backdrop-filter`로 stacking context 생성 + 메뉴 z-index `40` vs 모바일바 `150` → 모바일 stacking 별도 확인 필요.
