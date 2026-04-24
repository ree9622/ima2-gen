# ima2-gen UI/UX Overhaul v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 8-part UI/UX overhaul defined in
`docs/superpowers/specs/2026-04-24-ui-ux-overhaul-v2-design.md` — disambiguate
existing controls, add style chips, Vary, Enhance, Favorites, Theme,
Density, and Presets.

**Architecture:** React + Zustand + Vite on the UI, Express on the server.
No new runtime deps. Two new server routes (`/api/enhance-prompt`,
`/api/history/:filename/favorite`) reuse the existing OAuth proxy via
`lib/oauthStream.js`. Client-side state extensions live in the existing
`useAppStore`. Pure-logic modules (`styleChips`, `presets`, `theme`) are
placed under `ui/src/lib/` with `tests/*.test.js` mirrors following the
established `size-presets.test.js` pattern.

**Tech Stack:** React 18 + TypeScript, Zustand, Vite, Express, node:test.

---

## File Map

### New files

| Path | Responsibility |
|------|---------------|
| `ui/src/lib/styleChips.ts` | Chip data + `toggleChip` / `isChipActive` pure functions |
| `ui/src/lib/theme.ts` | Theme + density persistence and DOM application |
| `ui/src/lib/presets.ts` | Preset schema, curated builtins, load/save, active detection |
| `ui/src/components/StyleChips.tsx` | Accordion chip panel in the composer |
| `ui/src/components/ViewControls.tsx` | Theme + density segmented controls |
| `ui/src/components/PresetManager.tsx` | Preset dropdown + save/rename/delete |
| `ui/src/components/EnhanceModal.tsx` | Prompt-rewrite preview modal |
| `lib/enhance.js` | Server helper: OAuth text-only call for prompt rewrites |
| `lib/favorite.js` | Server helper: sidecar favorite-flag atomic rewrite |
| `tests/style-chips.test.js` | Mirror test for `styleChips.ts` pure functions |
| `tests/presets.test.js` | Mirror test for `presets.ts` load/save/active logic |
| `tests/favorite.test.js` | Sidecar rewrite + path-traversal rejection |
| `tests/enhance-prompt.test.js` | `/api/enhance-prompt` route via mocked OAuth |

### Modified files

| Path | What changes |
|------|--------------|
| `ui/src/lib/size.ts` | 4th category label `자유` → `고급` |
| `ui/src/components/SizePicker.tsx` | Card layout for `고급` category |
| `ui/src/components/RightPanel.tsx` | Updated labels; mount ViewControls + PresetManager |
| `ui/src/components/PromptComposer.tsx` | Mount StyleChips + Enhance button + EnhanceModal |
| `ui/src/components/ResultActions.tsx` | Add Vary button + Favorite star; reorder |
| `ui/src/components/HistoryStrip.tsx` | Favorite overlay on thumbs |
| `ui/src/components/GalleryModal.tsx` | Favorite filter chip |
| `ui/src/components/ShortcutsHelp.tsx` | Add `V`, `E`, `F` shortcuts |
| `ui/src/store/useAppStore.ts` | `varyCurrentResult`, `toggleFavorite`, `applyPreset`, chip-less (handled in composer state) |
| `ui/src/types.ts` | Add `favorite?: boolean` to `GenerateItem` |
| `ui/src/lib/api.ts` | `enhancePrompt()`, `setFavorite()` clients |
| `ui/src/main.tsx` | Call `applyThemeOnBoot()` before render |
| `ui/src/index.css` | Light palette under `[data-theme="light"]`; density vars under `[data-density="compact"]` |
| `server.js` | Two new routes; `favorite` passthrough in `listImages` |

---

## Ground Rules

- **Korean user copy.** All user-visible text in Korean. Code comments in
  English.
- **Follow existing patterns.** Zustand store already extends via `set` /
  `get`, keep that shape. Components use plain CSS classes (not CSS
  modules), keep that.
- **Tests use `node --test`.** Test files live under `tests/`. They cannot
  import `.ts` — mirror constants and pure logic like `size-presets.test.js`
  does.
- **Commits frequent.** Each task below ends with a commit.
- **No `--no-verify`.** Pre-commit hooks are respected.

---

## Task 1: Label Disambiguation

**Files:**
- Modify: `ui/src/lib/size.ts`
- Modify: `ui/src/components/SizePicker.tsx`
- Modify: `ui/src/components/RightPanel.tsx`
- Modify: `ui/src/index.css` (for `.size-picker__card` layout)

- [ ] **Step 1.1: Rename `자유` → `고급` and clarify auto/custom sub-labels**

Edit `ui/src/lib/size.ts`:

```ts
export const SIZE_GROUP_AUTO: ReadonlyArray<SizePresetItem> = [
  { value: "auto", label: "자동", sub: "모델이 결정" },
  { value: "custom", label: "직접 입력", sub: "커스텀 크기" },
];

// ...

export const SIZE_CATEGORIES: ReadonlyArray<{
  id: SizeCategory;
  label: string;
  icon: "square" | "landscape" | "portrait" | "custom";
  items: ReadonlyArray<SizePresetItem>;
}> = [
  { id: "square", label: "정사각", icon: "square", items: SIZE_GROUP_SQUARE },
  { id: "landscape", label: "가로", icon: "landscape", items: SIZE_GROUP_LANDSCAPE },
  { id: "portrait", label: "세로", icon: "portrait", items: SIZE_GROUP_PORTRAIT },
  { id: "auto", label: "고급", icon: "custom", items: SIZE_GROUP_AUTO },
];
```

- [ ] **Step 1.2: Render `고급` tab items as cards**

Edit `ui/src/components/SizePicker.tsx`. Replace the single `.size-picker__options` block with a conditional render: when `active === "auto"`, render the two items as full-width cards with icon+heading+sub; otherwise keep the pill layout.

```tsx
const isAdvanced = active === "auto";

// inside JSX, replace the single .size-picker__options block:
<div
  className={`size-picker__options${isAdvanced ? " size-picker__options--cards" : ""}`}
  role="tabpanel"
>
  {activeGroup.items.map((it) => {
    const selected = sizePreset === it.value;
    if (isAdvanced) {
      return (
        <button
          key={it.value}
          type="button"
          className={`size-picker__card${selected ? " active" : ""}`}
          onClick={() => setSizePreset(it.value as SizePreset)}
          title={`${it.label} (${it.sub})`}
        >
          <div className="size-picker__card-icon" aria-hidden="true">
            {it.value === "auto" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10" />
                <path d="M12 6v6l4 2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18M3 9h18" />
              </svg>
            )}
          </div>
          <div className="size-picker__card-text">
            <div className="size-picker__card-label">{it.label}</div>
            <div className="size-picker__card-sub">{it.sub}</div>
          </div>
        </button>
      );
    }
    return (
      <button
        key={it.value}
        type="button"
        className={`size-picker__option${selected ? " active" : ""}`}
        onClick={() => setSizePreset(it.value as SizePreset)}
        title={`${it.label} (${it.sub})`}
      >
        <span className="size-picker__option-label">{it.label}</span>
        <span className="size-picker__option-sub">{it.sub}</span>
      </button>
    );
  })}
</div>
```

- [ ] **Step 1.3: Add CSS for `.size-picker__card` and `--cards` modifier**

Append to `ui/src/index.css` in the size-picker section:

```css
.size-picker__options--cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.size-picker__card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s;
  text-align: left;
}
.size-picker__card:hover { border-color: var(--text-dim); }
.size-picker__card.active { border-color: var(--accent); background: var(--surface); }
.size-picker__card-icon { color: var(--text-dim); display: flex; }
.size-picker__card-text { display: flex; flex-direction: column; gap: 2px; }
.size-picker__card-label { font-size: 13px; font-weight: 500; }
.size-picker__card-sub { font-size: 11px; color: var(--text-dim); }
```

- [ ] **Step 1.4: Update quality, moderation, format, count labels in `RightPanel.tsx`**

Replace the top-of-file constants:

```tsx
const QUALITY_ITEMS = [
  { value: "low" as const, label: "낮음", sub: "~10–20초" },
  { value: "medium" as const, label: "중간", sub: "~20–40초" },
  { value: "high" as const, label: "높음", sub: "~40–80초" },
];

const FORMAT_ITEMS = [
  { value: "png" as const, label: "PNG", sub: "투명 지원" },
  { value: "jpeg" as const, label: "JPEG", sub: "작은 용량" },
  { value: "webp" as const, label: "WebP", sub: "균형" },
];

const MOD_ITEMS = [
  { value: "auto" as const, label: "표준", sub: "기본값" },
  {
    value: "low" as const,
    label: "완화",
    sub: "경계선 허용",
    color: "var(--amber)",
  },
];

const COUNT_ITEMS: { value: string; label: string; sub?: string }[] = [
  { value: "1", label: "1", sub: "기본" },
  { value: "2", label: "2", sub: "×2 비용" },
  { value: "4", label: "4", sub: "×4 비용" },
];
```

Also update the `FORMAT_ITEMS` pass to `OptionGroup<Format>` so the type accepts an optional `sub`. The existing `OptionItem` type already supports `sub`, so no type change is required.

For moderation, replace the `<p className="option-help">...</p>` paragraph with a small info link next to the section title. Extract this into a small inline component defined above `RightPanel`:

```tsx
function ModerationHelp() {
  return (
    <span
      className="option-help-icon"
      title="표준은 기본 안전 필터를, 완화는 경계선 프롬프트를 조금 더 허용합니다. 유해 콘텐츠 필터는 두 모드 모두에서 유지됩니다."
      aria-label="모더레이션 안내"
    >
      ?
    </span>
  );
}
```

Place `<ModerationHelp />` next to the "모더레이션" title. The existing `OptionGroup` already renders the `title` prop — extend the group or render the label + icon manually using an inline `section-title` wrapper. Simplest path: render a custom header before the OptionGroup:

```tsx
<div className="option-group">
  <div className="section-title option-title-with-help">
    모더레이션
    <ModerationHelp />
  </div>
  <OptionGroup<Moderation>
    items={MOD_ITEMS}
    value={moderation}
    onChange={setModeration}
  />
</div>
```

Remove the old `<OptionGroup<Moderation> title="모더레이션" ... />` and the following `<p className="option-help">`.

- [ ] **Step 1.5: Add CSS for `.option-help-icon`**

Append to `ui/src/index.css`:

```css
.option-title-with-help {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.option-help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--border);
  font-size: 10px;
  color: var(--text-dim);
  cursor: help;
  user-select: none;
}
.option-help-icon:hover { color: var(--text); border-color: var(--text-dim); }
```

- [ ] **Step 1.6: Run the existing size-presets test to confirm no regression**

Run: `npm test`
Expected: all tests pass. (The label rename doesn't affect the preset list.)

- [ ] **Step 1.7: Commit**

```bash
git add ui/src/lib/size.ts ui/src/components/SizePicker.tsx ui/src/components/RightPanel.tsx ui/src/index.css
git commit -m "feat(ui): clarify right-panel labels and split auto/custom into cards

Quality sub now reads as time-estimate range instead of conflated
quality/speed adjective. Format/count gain cost/usage hints. Moderation
label becomes 표준/완화 with a (?) tooltip replacing the inline paragraph.
Size '자유' tab renamed to '고급' and its two options (auto, custom)
render as clearly-labeled cards."
```

---

## Task 2: Theme + Density Infrastructure

**Files:**
- Create: `ui/src/lib/theme.ts`
- Create: `ui/src/components/ViewControls.tsx`
- Modify: `ui/src/main.tsx`
- Modify: `ui/src/index.css`
- Modify: `ui/src/components/RightPanel.tsx`

- [ ] **Step 2.1: Write theme module**

Create `ui/src/lib/theme.ts`:

```ts
export type ThemeMode = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

const THEME_KEY = "ima2.theme";
const DENSITY_KEY = "ima2.density";

export function loadTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "system" || raw === "light" || raw === "dark") return raw;
  } catch {}
  return "system";
}

export function loadDensity(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    if (raw === "comfortable" || raw === "compact") return raw;
  } catch {}
  return "comfortable";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveTheme(mode));
}

export function applyDensity(d: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", d);
}

export function saveTheme(mode: ThemeMode): void {
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
  applyTheme(mode);
}

export function saveDensity(d: Density): void {
  try { localStorage.setItem(DENSITY_KEY, d); } catch {}
  applyDensity(d);
}

// Watch system preference when in "system" mode; returns an unsubscriber.
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    if (getMode() === "system") applyTheme("system");
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

export function applyOnBoot(): void {
  applyTheme(loadTheme());
  applyDensity(loadDensity());
}
```

- [ ] **Step 2.2: Call `applyOnBoot()` before render**

Edit `ui/src/main.tsx`. Import and call `applyOnBoot()` at the top of the module, before `createRoot(...).render(...)`. Use Read to locate the exact current contents first.

Expected resulting top of file:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyOnBoot } from "./lib/theme";

applyOnBoot();
```

- [ ] **Step 2.3: Add light palette and density tokens to `index.css`**

Append under the existing `:root { ... }` block:

```css
:root[data-theme="light"] {
  --bg: #fafaf9;
  --surface: #ffffff;
  --surface-2: #f5f5f4;
  --border: #e7e5e4;
  --text: #1c1917;
  --text-dim: #78716c;
  --accent: #1c1917;
  --accent-bright: #000;
}

:root[data-density="compact"] {
  --density-pad-sm: 6px;
  --density-pad-md: 8px;
  --density-pad-lg: 12px;
  --density-gap-sm: 4px;
  --density-gap-md: 8px;
}

:root {
  --density-pad-sm: 8px;
  --density-pad-md: 12px;
  --density-pad-lg: 16px;
  --density-gap-sm: 6px;
  --density-gap-md: 12px;
}
```

Then update a handful of high-traffic blocks to use density vars. The density vars are opt-in — only apply them to places where a visible change is desirable. Start conservative:

```css
.sidebar__scroll {
  padding: var(--density-pad-lg) var(--density-pad-md) var(--density-pad-md);
  gap: var(--density-gap-md);
}
.right-panel-body {
  padding: var(--density-pad-lg) var(--density-pad-md);
  gap: var(--density-gap-md);
}
```

Use `Read` on the existing rules first to preserve the other properties (flex, flex-direction, etc.) and only replace padding/gap values.

- [ ] **Step 2.4: Write `<ViewControls />` component**

Create `ui/src/components/ViewControls.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  loadDensity,
  loadTheme,
  saveDensity,
  saveTheme,
  watchSystemTheme,
  type Density,
  type ThemeMode,
} from "../lib/theme";

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

const DENSITIES: { value: Density; label: string }[] = [
  { value: "comfortable", label: "기본" },
  { value: "compact", label: "좁게" },
];

export function ViewControls() {
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [density, setDensity] = useState<Density>(loadDensity);

  useEffect(() => {
    return watchSystemTheme(() => theme);
  }, [theme]);

  const onTheme = (v: ThemeMode) => { setTheme(v); saveTheme(v); };
  const onDensity = (v: Density) => { setDensity(v); saveDensity(v); };

  return (
    <div className="view-controls">
      <div className="section-title">보기</div>
      <div className="seg-group" role="radiogroup" aria-label="테마">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            className={`seg${theme === t.value ? " active" : ""}`}
            onClick={() => onTheme(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="seg-group" role="radiogroup" aria-label="밀도">
        {DENSITIES.map((d) => (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={density === d.value}
            className={`seg${density === d.value ? " active" : ""}`}
            onClick={() => onDensity(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.5: Add CSS for ViewControls segmented group**

Append to `ui/src/index.css`:

```css
.view-controls { display: flex; flex-direction: column; gap: 6px; }
.view-controls .section-title { margin-bottom: 2px; }

.seg-group {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px;
}
.seg {
  background: transparent;
  color: var(--text-dim);
  border: none;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: calc(var(--radius) - 2px);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.seg:hover { color: var(--text); }
.seg.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border);
}
```

- [ ] **Step 2.6: Mount `<ViewControls />` in RightPanel**

Edit `ui/src/components/RightPanel.tsx`. Import `ViewControls` and mount it as the **first** element inside `.right-panel-body`, above `<BillingBar />`:

```tsx
import { ViewControls } from "./ViewControls";
// ...
<div id="right-panel-body" className="right-panel-body" hidden={!open}>
  <ViewControls />
  <BillingBar />
  {/* rest unchanged */}
</div>
```

- [ ] **Step 2.7: Visual sanity check**

Run: `npm run dev`
Open the UI. Toggle between 시스템 / 라이트 / 다크 — the whole UI should flip palette. Toggle 기본 / 좁게 — sidebar and right panel should tighten.

Document any missed hard-coded color (there will be a few — log but do not fix in this task; Task 2.8 handles the polish).

- [ ] **Step 2.8: Light theme polish — fix any obviously-wrong colors**

Grep `ui/src/index.css` for literal hex colors (`rg '#[0-9a-f]{3,6}' ui/src/index.css`). For every non-variable color that appears off in light theme, replace with the appropriate CSS variable. Focus on backgrounds, borders, and text. Skip accent colors (green pulse dot, amber, red) — those stay literal.

Expected result: light theme is usable, even if not yet pixel-perfect. Visual perfection is iterative; this task's bar is "no unreadable text, no invisible borders."

- [ ] **Step 2.9: Commit**

```bash
git add ui/src/lib/theme.ts ui/src/components/ViewControls.tsx ui/src/main.tsx ui/src/index.css ui/src/components/RightPanel.tsx
git commit -m "feat(ui): add theme (light/dark/system) and density controls

ViewControls mounts at the top of the right panel. Theme + density
apply via data attributes on <html>. System mode watches
prefers-color-scheme. Choices persist in localStorage."
```

---

## Task 3: Style Modifier Chips

**Files:**
- Create: `ui/src/lib/styleChips.ts`
- Create: `ui/src/components/StyleChips.tsx`
- Create: `tests/style-chips.test.js`
- Modify: `ui/src/components/PromptComposer.tsx`
- Modify: `ui/src/index.css`

- [ ] **Step 3.1: Write the failing test first**

Create `tests/style-chips.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror of ui/src/lib/styleChips.ts — keep in sync.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isChipActive(prompt, token) {
  if (!prompt) return false;
  const re = new RegExp(`(^|,\\s*)${escapeRegExp(token)}(?=\\s*(?:,|$))`);
  return re.test(prompt);
}

function toggleChip(prompt, token) {
  const trimmed = prompt.trim();
  if (isChipActive(trimmed, token)) {
    const re = new RegExp(`(^|,\\s*)${escapeRegExp(token)}(?=\\s*(?:,|$))`);
    const next = trimmed.replace(re, (_m, lead) => (lead ? "" : ""));
    return next.replace(/^,\s*/, "").replace(/,\s*,/g, ",").trim();
  }
  if (!trimmed) return token;
  return `${trimmed}, ${token}`;
}

describe("styleChips.toggleChip", () => {
  it("adds a token to empty prompt", () => {
    assert.equal(toggleChip("", "시네마틱"), "시네마틱");
  });
  it("appends with comma separator", () => {
    assert.equal(toggleChip("셀카", "자연광"), "셀카, 자연광");
  });
  it("removes an existing token at end", () => {
    assert.equal(toggleChip("셀카, 자연광", "자연광"), "셀카");
  });
  it("removes an existing token in middle", () => {
    assert.equal(toggleChip("셀카, 자연광, 전신", "자연광"), "셀카, 전신");
  });
  it("removes a standalone token", () => {
    assert.equal(toggleChip("자연광", "자연광"), "");
  });
  it("isChipActive detects mid-string token", () => {
    assert.equal(isChipActive("셀카, 자연광, 전신", "자연광"), true);
  });
  it("isChipActive rejects partial match", () => {
    assert.equal(isChipActive("자연광선", "자연광"), false);
  });
});
```

- [ ] **Step 3.2: Run the test — expect failure**

Run: `node --test tests/style-chips.test.js`
Expected: pass (logic is inline in test). This test guards the mirror; the TS file must match.

Note: unlike a typical TDD loop, this test lives alongside the source by being a *mirror*. The failing step is skipped because the test is self-contained. This is the established pattern (see `size-presets.test.js`).

- [ ] **Step 3.3: Write `ui/src/lib/styleChips.ts`**

```ts
export type ChipGroup = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  chips: ReadonlyArray<string>;
};

export const CHIP_GROUPS: ReadonlyArray<ChipGroup> = [
  {
    id: "mood",
    label: "무드·스타일",
    defaultOpen: true,
    chips: [
      "시네마틱", "자연광", "수묵화", "3D 렌더",
      "일러스트", "수채", "유화", "픽셀 아트",
    ],
  },
  {
    id: "portrait",
    label: "인물 톤",
    chips: [
      "인물 사진", "셀카", "전신", "얼굴 클로즈업",
      "반신", "자연스러운 포즈", "피부 보정 최소",
    ],
  },
  {
    id: "quality",
    label: "퀄리티",
    chips: [
      "고해상도", "디테일 풍부", "선명한 초점", "영화적 라이팅",
    ],
  },
  {
    id: "lens",
    label: "카메라·렌즈",
    chips: [
      "35mm 표준", "50mm 표준", "85mm 포트레이트", "광각", "접사",
    ],
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isChipActive(prompt: string, token: string): boolean {
  if (!prompt) return false;
  const re = new RegExp(`(^|,\\s*)${escapeRegExp(token)}(?=\\s*(?:,|$))`);
  return re.test(prompt);
}

export function toggleChip(prompt: string, token: string): string {
  const trimmed = prompt.trim();
  if (isChipActive(trimmed, token)) {
    const re = new RegExp(`(^|,\\s*)${escapeRegExp(token)}(?=\\s*(?:,|$))`);
    const next = trimmed.replace(re, () => "");
    return next.replace(/^,\s*/, "").replace(/,\s*,/g, ",").trim();
  }
  if (!trimmed) return token;
  return `${trimmed}, ${token}`;
}
```

- [ ] **Step 3.4: Write `<StyleChips />` component**

Create `ui/src/components/StyleChips.tsx`:

```tsx
import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { CHIP_GROUPS, isChipActive, toggleChip } from "../lib/styleChips";

export function StyleChips() {
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(CHIP_GROUPS.filter((g) => g.defaultOpen).map((g) => g.id)),
  );

  const toggleGroup = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onChip = (token: string) => {
    setPrompt(toggleChip(prompt, token));
  };

  return (
    <div className="chip-panel">
      {CHIP_GROUPS.map((group) => {
        const open = openIds.has(group.id);
        return (
          <div key={group.id} className="chip-group">
            <button
              type="button"
              className={`chip-group__header${open ? " open" : ""}`}
              onClick={() => toggleGroup(group.id)}
              aria-expanded={open}
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
                style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <span>{group.label}</span>
            </button>
            {open && (
              <div className="chip-group__body">
                {group.chips.map((token) => {
                  const active = isChipActive(prompt, token);
                  return (
                    <button
                      key={token}
                      type="button"
                      className={`chip${active ? " active" : ""}`}
                      onClick={() => onChip(token)}
                      aria-pressed={active}
                    >
                      {token}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3.5: Add CSS for chip panel**

Append to `ui/src/index.css`:

```css
.chip-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.chip-group__header {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 2px;
  text-align: left;
}
.chip-group__header:hover { color: var(--text); }
.chip-group__body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0 8px;
}
.chip {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.12s;
}
.chip:hover { color: var(--text); border-color: var(--text-dim); }
.chip.active {
  background: var(--text);
  color: var(--bg);
  border-color: var(--text);
}
```

- [ ] **Step 3.6: Mount in PromptComposer**

Edit `ui/src/components/PromptComposer.tsx`. Import `StyleChips` and insert between `composer__header` div and the `composer__chips` (refs) div:

```tsx
import { StyleChips } from "./StyleChips";

// ...inside JSX, after composer__header closing tag, before refs.length check:
<StyleChips />
```

- [ ] **Step 3.7: Run tests**

Run: `npm test`
Expected: all tests pass (including the new `style-chips.test.js`).

- [ ] **Step 3.8: Manual check**

Run: `npm run dev`. Type a short prompt, click a chip → token appends. Click again → token removes. Type something else and verify the chip state stays consistent.

- [ ] **Step 3.9: Commit**

```bash
git add ui/src/lib/styleChips.ts ui/src/components/StyleChips.tsx ui/src/components/PromptComposer.tsx tests/style-chips.test.js ui/src/index.css
git commit -m "feat(ui): add style modifier chip panel to composer

Four collapsible groups (mood, portrait tone, quality, lens). Clicking
a chip appends or removes a comma-delimited token in the prompt.
Active state derives from the prompt text so chips survive prompt
reuse and external edits. Includes pure-function tests."
```

---

## Task 4: Vary Button

**Files:**
- Modify: `ui/src/store/useAppStore.ts`
- Modify: `ui/src/components/ResultActions.tsx`

- [ ] **Step 4.1: Add `varyCurrentResult` action to the store**

Edit `ui/src/store/useAppStore.ts`. Find the `generate` action definition (search for `generate:` at top level of the create). Read a ~100 line window around it, then:

1. Allow `generate()` to accept an optional overrides object:

Change the signature from `generate: async () => { ... }` to:

```ts
generate: async (overrides?: { overridePrompt?: string; overrideCount?: Count }) => {
  // inside, use:
  const prompt = overrides?.overridePrompt ?? state.prompt;
  const n = overrides?.overrideCount ?? state.count;
  // ...use those everywhere the old prompt/count were used
}
```

(Use Read first to find the real variable names — the store is 1300 lines, so preserve the exact structure.)

2. Add a new action at the same level:

```ts
varyCurrentResult: async () => {
  const s = get();
  const promptFromResult = s.currentImage?.prompt;
  if (!promptFromResult) {
    s.showToast("복제할 결과가 없습니다", true);
    return;
  }
  await s.generate({ overridePrompt: promptFromResult, overrideCount: 1 });
},
```

Also extend the store's type declaration near the top where other actions are typed; add:

```ts
varyCurrentResult: () => Promise<void>;
```

and update `generate`'s type to:

```ts
generate: (overrides?: { overridePrompt?: string; overrideCount?: Count }) => Promise<void>;
```

- [ ] **Step 4.2: Update ResultActions button order**

Replace `ui/src/components/ResultActions.tsx` body. Keep the existing helper functions (download, copyImage, copyPrompt, newFromHere). Add `vary`:

```tsx
const vary = useAppStore((s) => s.varyCurrentResult);

// ...
return (
  <div className="result-actions">
    <button
      type="button"
      className="action-btn action-btn--primary"
      onClick={() => void vary()}
      title="같은 프롬프트로 한 장 더 생성"
    >
      변형
    </button>
    <button type="button" className="action-btn" onClick={download}>
      다운로드
    </button>
    <button type="button" className="action-btn" onClick={copyImage}>
      이미지 복사
    </button>
    <button type="button" className="action-btn" onClick={copyPrompt}>
      프롬프트 복사
    </button>
    <button
      type="button"
      className="action-btn"
      onClick={newFromHere}
      title="이 이미지의 프롬프트를 가져와 이어서 작업"
    >
      여기서 이어서
    </button>
  </div>
);
```

The `여기서 이어서` button is demoted from primary to secondary by removing `action-btn--primary`.

- [ ] **Step 4.3: Manual check**

Run: `npm run dev`. Generate an image. Click "변형". A new generation should start with the same prompt, using current right-panel settings, producing exactly 1 result. Confirm via the in-flight list.

- [ ] **Step 4.4: Commit**

```bash
git add ui/src/store/useAppStore.ts ui/src/components/ResultActions.tsx
git commit -m "feat(ui): add 변형 button to re-roll current result

Vary uses the current result's prompt (not the composer's edited text)
and the current right-panel settings, forcing count=1. generate()
gains an optional overrides argument to support this."
```

---

## Task 5: Presets

**Files:**
- Create: `ui/src/lib/presets.ts`
- Create: `ui/src/components/PresetManager.tsx`
- Create: `tests/presets.test.js`
- Modify: `ui/src/store/useAppStore.ts`
- Modify: `ui/src/components/RightPanel.tsx`
- Modify: `ui/src/index.css`

- [ ] **Step 5.1: Write the mirror test**

Create `tests/presets.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror of ui/src/lib/presets.ts — keep in sync with curated seed.
const BUILTINS = [
  {
    id: "builtin-selfie-hi",
    name: "셀카 고품질",
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "1024x1536",
      format: "png", moderation: "auto", count: 1,
    },
  },
  {
    id: "builtin-insta-sq",
    name: "인스타 사각",
    builtIn: true,
    payload: {
      quality: "medium", sizePreset: "1024x1024",
      format: "jpeg", moderation: "auto", count: 2,
    },
  },
  {
    id: "builtin-illust-4k",
    name: "일러스트 4K",
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "3824x2160",
      format: "webp", moderation: "auto", count: 1,
    },
  },
];

describe("presets builtins", () => {
  it("exactly 3 builtins are seeded", () => {
    assert.equal(BUILTINS.length, 3);
  });
  it("each builtin has a non-empty name", () => {
    for (const p of BUILTINS) assert.ok(p.name && p.name.length > 0);
  });
  it("each builtin has a valid payload", () => {
    for (const p of BUILTINS) {
      assert.ok(["low", "medium", "high"].includes(p.payload.quality));
      assert.ok([1, 2, 4].includes(p.payload.count));
    }
  });
});
```

Run: `node --test tests/presets.test.js`
Expected: PASS.

- [ ] **Step 5.2: Write `ui/src/lib/presets.ts`**

```ts
import type { Count, Format, Moderation, Quality, SizePreset } from "../types";

export type PresetPayload = {
  quality: Quality;
  sizePreset: SizePreset;
  customW?: number;
  customH?: number;
  format: Format;
  moderation: Moderation;
  count: Count;
};

export type Preset = {
  id: string;
  name: string;
  createdAt: number;
  builtIn?: boolean;
  payload: PresetPayload;
};

const STORE_KEY = "ima2.presets";

export const BUILTINS: ReadonlyArray<Preset> = [
  {
    id: "builtin-selfie-hi",
    name: "셀카 고품질",
    createdAt: 0,
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "1024x1536",
      format: "png", moderation: "auto", count: 1,
    },
  },
  {
    id: "builtin-insta-sq",
    name: "인스타 사각",
    createdAt: 0,
    builtIn: true,
    payload: {
      quality: "medium", sizePreset: "1024x1024",
      format: "jpeg", moderation: "auto", count: 2,
    },
  },
  {
    id: "builtin-illust-4k",
    name: "일러스트 4K",
    createdAt: 0,
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "3824x2160",
      format: "webp", moderation: "auto", count: 1,
    },
  },
];

function isValidPayload(p: unknown): p is PresetPayload {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.quality === "string" &&
    typeof obj.sizePreset === "string" &&
    typeof obj.format === "string" &&
    typeof obj.moderation === "string" &&
    typeof obj.count === "number"
  );
}

export function loadPresets(): Preset[] {
  let user: Preset[] = [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        user = arr.filter(
          (p): p is Preset =>
            p && typeof p.id === "string" && typeof p.name === "string" &&
            typeof p.createdAt === "number" && isValidPayload(p.payload),
        );
      }
    }
  } catch {}
  return [...BUILTINS, ...user];
}

export function saveUserPresets(user: Preset[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(user.filter((p) => !p.builtIn)));
  } catch {}
}

export function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function findActivePreset(
  list: ReadonlyArray<Preset>,
  payload: PresetPayload,
): Preset | null {
  for (const p of list) {
    const q = p.payload;
    if (
      q.quality === payload.quality &&
      q.sizePreset === payload.sizePreset &&
      q.format === payload.format &&
      q.moderation === payload.moderation &&
      q.count === payload.count &&
      (q.sizePreset !== "custom" ||
        (q.customW === payload.customW && q.customH === payload.customH))
    ) return p;
  }
  return null;
}
```

- [ ] **Step 5.3: Add `applyPreset` to the store**

Edit `ui/src/store/useAppStore.ts`. Find the quality/size/format/moderation/count setters. Add a new action:

```ts
applyPreset: (payload: PresetPayload) => {
  set({
    quality: payload.quality,
    sizePreset: payload.sizePreset,
    format: payload.format,
    moderation: payload.moderation,
    count: payload.count,
    ...(payload.sizePreset === "custom" && payload.customW && payload.customH
      ? { customW: payload.customW, customH: payload.customH }
      : {}),
  });
},
```

Import the type:

```ts
import type { PresetPayload } from "../lib/presets";
```

Add to the store's type declaration:

```ts
applyPreset: (payload: PresetPayload) => void;
```

- [ ] **Step 5.4: Write `<PresetManager />` component**

Create `ui/src/components/PresetManager.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import {
  findActivePreset,
  loadPresets,
  newPresetId,
  saveUserPresets,
  type Preset,
} from "../lib/presets";

export function PresetManager() {
  const quality = useAppStore((s) => s.quality);
  const sizePreset = useAppStore((s) => s.sizePreset);
  const customW = useAppStore((s) => s.customW);
  const customH = useAppStore((s) => s.customH);
  const format = useAppStore((s) => s.format);
  const moderation = useAppStore((s) => s.moderation);
  const count = useAppStore((s) => s.count);
  const applyPreset = useAppStore((s) => s.applyPreset);
  const showToast = useAppStore((s) => s.showToast);

  const [list, setList] = useState<Preset[]>(() => loadPresets());
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  const activePayload = useMemo(
    () => ({ quality, sizePreset, customW, customH, format, moderation, count }),
    [quality, sizePreset, customW, customH, format, moderation, count],
  );

  const active = findActivePreset(list, activePayload);

  const commitList = (next: Preset[]) => {
    setList(next);
    saveUserPresets(next);
  };

  const onApply = (id: string) => {
    const p = list.find((x) => x.id === id);
    if (p) applyPreset(p.payload);
  };

  const onSave = () => {
    const name = newName.trim();
    if (!name) { setSaving(false); return; }
    const existing = list.find((p) => p.name === name && !p.builtIn);
    if (existing) {
      commitList(list.map((p) =>
        p.id === existing.id
          ? { ...p, payload: { ...activePayload }, createdAt: Date.now() }
          : p,
      ));
      showToast("프리셋을 덮어썼습니다");
    } else {
      const p: Preset = {
        id: newPresetId(),
        name,
        createdAt: Date.now(),
        payload: { ...activePayload },
      };
      commitList([...list, p]);
      showToast("프리셋을 저장했습니다");
    }
    setNewName("");
    setSaving(false);
  };

  const onDelete = (id: string) => {
    commitList(list.filter((p) => p.id !== id));
  };

  useEffect(() => {
    // Refresh if storage changed in another tab.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ima2.presets") setList(loadPresets());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <div className="preset-manager">
      <div className="section-title">프리셋</div>
      <div className="preset-manager__row">
        <select
          className="preset-manager__select"
          value={active?.id ?? ""}
          onChange={(e) => e.target.value && onApply(e.target.value)}
        >
          <option value="" disabled>
            {active ? active.name : "사용자 지정"}
          </option>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.builtIn ? "★ " : ""}{p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="preset-manager__save"
          onClick={() => setSaving((v) => !v)}
          title="현재 설정을 프리셋으로 저장"
        >
          저장
        </button>
      </div>
      {saving && (
        <div className="preset-manager__name-row">
          <input
            type="text"
            autoFocus
            className="preset-manager__name-input"
            placeholder="프리셋 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") { setSaving(false); setNewName(""); }
            }}
          />
          <button type="button" className="preset-manager__confirm" onClick={onSave}>
            확인
          </button>
        </div>
      )}
      {!active && list.some((p) => !p.builtIn) && (
        <button
          type="button"
          className="preset-manager__delete-hint"
          onClick={() => {
            const name = prompt("삭제할 프리셋 이름을 입력하세요");
            if (!name) return;
            const target = list.find((p) => p.name === name && !p.builtIn);
            if (target) onDelete(target.id);
          }}
        >
          사용자 프리셋 삭제
        </button>
      )}
    </div>
  );
}
```

Note: right-click context menus add significant complexity; this implementation uses a simple "delete by name" prompt for user presets, keeping the UI footprint small. Builtins cannot be deleted.

- [ ] **Step 5.5: Add CSS for PresetManager**

Append to `ui/src/index.css`:

```css
.preset-manager { display: flex; flex-direction: column; gap: 6px; }
.preset-manager__row { display: flex; gap: 6px; }
.preset-manager__select {
  flex: 1 1 auto;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius);
  padding: 6px 8px;
  font-size: 12px;
}
.preset-manager__save,
.preset-manager__confirm,
.preset-manager__delete-hint {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.preset-manager__save:hover,
.preset-manager__confirm:hover { border-color: var(--text-dim); }
.preset-manager__name-row { display: flex; gap: 6px; }
.preset-manager__name-input {
  flex: 1 1 auto;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius);
  padding: 6px 8px;
  font-size: 12px;
}
.preset-manager__delete-hint {
  font-size: 10px;
  color: var(--text-dim);
  text-align: left;
  background: transparent;
  padding: 2px 0;
  border: none;
}
```

- [ ] **Step 5.6: Mount `<PresetManager />`**

Edit `ui/src/components/RightPanel.tsx`. Insert `<PresetManager />` after `<ViewControls />` and before `<BillingBar />`:

```tsx
import { PresetManager } from "./PresetManager";
// ...
<ViewControls />
<PresetManager />
<BillingBar />
```

- [ ] **Step 5.7: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5.8: Manual check**

Run: `npm run dev`. Confirm 3 built-in presets exist. Change settings, click 저장, enter a name, confirm. Refresh — preset persists. Apply built-in — settings flip.

- [ ] **Step 5.9: Commit**

```bash
git add ui/src/lib/presets.ts ui/src/components/PresetManager.tsx tests/presets.test.js ui/src/store/useAppStore.ts ui/src/components/RightPanel.tsx ui/src/index.css
git commit -m "feat(ui): add setting presets with 3 curated builtins

PresetManager mounts between ViewControls and BillingBar. Users can
save the current settings bundle under a name; 3 builtins ship seeded
(셀카 고품질, 인스타 사각, 일러스트 4K). Store adds applyPreset action.
Active preset is derived from the store state each render."
```

---

## Task 6: Favorites

**Files:**
- Create: `lib/favorite.js`
- Create: `tests/favorite.test.js`
- Modify: `server.js`
- Modify: `ui/src/types.ts`
- Modify: `ui/src/lib/api.ts`
- Modify: `ui/src/store/useAppStore.ts`
- Modify: `ui/src/components/ResultActions.tsx`
- Modify: `ui/src/components/HistoryStrip.tsx`
- Modify: `ui/src/components/GalleryModal.tsx`
- Modify: `ui/src/index.css`

- [ ] **Step 6.1: Write the failing test**

Create `tests/favorite.test.js`:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setFavoriteFlag, InvalidFilenameError, SidecarMissingError } from "../lib/favorite.js";

let tmp;

beforeEach(async () => {
  tmp = join(tmpdir(), `ima2-fav-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("setFavoriteFlag", () => {
  it("sets favorite=true in an existing sidecar", async () => {
    await writeFile(join(tmp, "a.png"), "img");
    await writeFile(join(tmp, "a.png.json"), JSON.stringify({ prompt: "x" }));
    const result = await setFavoriteFlag(tmp, "a.png", true);
    assert.equal(result.favorite, true);
    const raw = JSON.parse(await readFile(join(tmp, "a.png.json"), "utf-8"));
    assert.equal(raw.favorite, true);
    assert.equal(raw.prompt, "x");
  });
  it("clears favorite when value is false", async () => {
    await writeFile(join(tmp, "a.png"), "img");
    await writeFile(join(tmp, "a.png.json"), JSON.stringify({ favorite: true }));
    await setFavoriteFlag(tmp, "a.png", false);
    const raw = JSON.parse(await readFile(join(tmp, "a.png.json"), "utf-8"));
    assert.equal(raw.favorite, false);
  });
  it("rejects path traversal", async () => {
    await assert.rejects(
      () => setFavoriteFlag(tmp, "../escape.png", true),
      (err) => err instanceof InvalidFilenameError,
    );
  });
  it("rejects absolute paths", async () => {
    await assert.rejects(
      () => setFavoriteFlag(tmp, "/etc/passwd", true),
      (err) => err instanceof InvalidFilenameError,
    );
  });
  it("rejects non-existent sidecar", async () => {
    await assert.rejects(
      () => setFavoriteFlag(tmp, "missing.png", true),
      (err) => err instanceof SidecarMissingError,
    );
  });
});
```

- [ ] **Step 6.2: Run test — expect failure**

Run: `node --test tests/favorite.test.js`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Write `lib/favorite.js`**

```js
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { join, normalize, isAbsolute, sep } from "node:path";

export class InvalidFilenameError extends Error {
  constructor(msg) { super(msg); this.code = "INVALID_FILENAME"; this.status = 400; }
}
export class SidecarMissingError extends Error {
  constructor(msg) { super(msg); this.code = "SIDECAR_MISSING"; this.status = 404; }
}

function validateFilename(baseDir, filename) {
  if (!filename || typeof filename !== "string") {
    throw new InvalidFilenameError("filename required");
  }
  if (isAbsolute(filename)) {
    throw new InvalidFilenameError("filename must be relative");
  }
  const norm = normalize(filename);
  if (norm.startsWith("..") || norm.split(sep).includes("..")) {
    throw new InvalidFilenameError("filename must not escape base directory");
  }
  const full = join(baseDir, norm);
  if (!full.startsWith(baseDir)) {
    throw new InvalidFilenameError("filename resolves outside base directory");
  }
  return full;
}

export async function setFavoriteFlag(baseDir, filename, value) {
  const full = validateFilename(baseDir, filename);
  const sidecarPath = `${full}.json`;

  let meta;
  try {
    const raw = await readFile(sidecarPath, "utf-8");
    meta = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new SidecarMissingError(`sidecar not found: ${filename}`);
    }
    throw err;
  }

  meta.favorite = Boolean(value);

  // Atomic-ish write: tmp file + rename.
  const tmpPath = `${sidecarPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(meta));
  await rename(tmpPath, sidecarPath);

  return { filename, favorite: meta.favorite };
}
```

- [ ] **Step 6.4: Run tests — expect pass**

Run: `node --test tests/favorite.test.js`
Expected: PASS.

- [ ] **Step 6.5: Wire server route**

Edit `server.js`. In the `listImages` mapping in the `/api/history` handler, add a passthrough for favorite. Find this block:

```js
return {
  filename: rel,
  url: `/generated/${rel.split("/").map(encodeURIComponent).join("/")}`,
  createdAt: meta?.createdAt || st?.mtimeMs || 0,
  prompt: meta?.prompt || null,
  // ...
  kind: meta?.kind || null,
};
```

Add `favorite: meta?.favorite === true,` to the returned object.

Then add a new route near the other `/api/history/:filename/*` routes:

```js
import { setFavoriteFlag } from "./lib/favorite.js";
// ...
app.post("/api/history/:filename/favorite", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const value = Boolean(req.body?.value);
    const generatedDir = join(__dirname, "generated");
    const result = await setFavoriteFlag(generatedDir, filename, value);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});
```

The `setFavoriteFlag` import goes up top with the other `lib/` imports.

- [ ] **Step 6.6: Extend `GenerateItem` type**

Edit `ui/src/types.ts`:

```ts
export type GenerateItem = {
  // ...existing fields...
  favorite?: boolean;
};
```

- [ ] **Step 6.7: Add `setFavorite` API client**

Edit `ui/src/lib/api.ts`. Add:

```ts
export async function setFavorite(filename: string, value: boolean): Promise<{ filename: string; favorite: boolean }> {
  const res = await fetch(
    `/api/history/${encodeURIComponent(filename)}/favorite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `setFavorite failed: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 6.8: Add `toggleFavorite` action to the store**

Edit `ui/src/store/useAppStore.ts`. Import and add action:

```ts
import { setFavorite } from "../lib/api";
// ...
toggleFavorite: async (filename?: string) => {
  const s = get();
  const target = filename ?? s.currentImage?.filename;
  if (!target) return;
  const currentItem =
    s.history.find((h) => h.filename === target) ??
    (s.currentImage?.filename === target ? s.currentImage : null);
  const next = !currentItem?.favorite;

  // Optimistic update.
  const patchItem = <T extends { filename?: string; favorite?: boolean }>(it: T): T =>
    it.filename === target ? { ...it, favorite: next } : it;
  set({
    history: s.history.map(patchItem),
    currentImage: s.currentImage ? patchItem(s.currentImage) : s.currentImage,
  });

  try {
    await setFavorite(target, next);
  } catch (err) {
    // Revert.
    const revert = <T extends { filename?: string; favorite?: boolean }>(it: T): T =>
      it.filename === target ? { ...it, favorite: !next } : it;
    set({
      history: get().history.map(revert),
      currentImage: get().currentImage ? revert(get().currentImage!) : get().currentImage,
    });
    s.showToast("즐겨찾기 저장 실패", true);
    console.error(err);
  }
},
```

Add to store type declaration:

```ts
toggleFavorite: (filename?: string) => Promise<void>;
```

- [ ] **Step 6.9: Add Favorite star button to ResultActions**

Edit `ui/src/components/ResultActions.tsx`. Add to the button row, between "프롬프트 복사" and "여기서 이어서":

```tsx
const toggleFavorite = useAppStore((s) => s.toggleFavorite);
const isFav = Boolean(currentImage?.favorite);

// ...
<button
  type="button"
  className={`action-btn action-btn--icon${isFav ? " action-btn--active" : ""}`}
  onClick={() => void toggleFavorite()}
  title={isFav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
  aria-pressed={isFav}
>
  {isFav ? "★" : "☆"}
</button>
```

- [ ] **Step 6.10: Add favorite overlay to HistoryStrip**

Edit `ui/src/components/HistoryStrip.tsx`. Inside each history thumb button, add:

```tsx
{item.favorite ? (
  <span className="history-thumb__fav" aria-label="즐겨찾기">★</span>
) : null}
```

- [ ] **Step 6.11: Add favorite filter to GalleryModal**

Edit `ui/src/components/GalleryModal.tsx`. Add a state `favOnly` and a filter toggle. Find the existing search-row rendering and add a chip toggle next to the input. Apply `favOnly` inside the memoized filter.

Look for `const normalizedQuery = useMemo(...)` — below it, add filter logic; and update the existing filter to include favorite when `favOnly` is true. Also add UI near the search input:

```tsx
const [favOnly, setFavOnly] = useState(false);
// Inside the render, near the search input:
<button
  type="button"
  className={`gallery-filter-chip${favOnly ? " active" : ""}`}
  onClick={() => setFavOnly((v) => !v)}
  title="즐겨찾기만 보기"
>
  ★ 즐겨찾기
</button>
```

(Read the existing filter pipeline first — apply `favOnly` as an AND with the query match in the same memoized loop.)

- [ ] **Step 6.12: Add CSS**

Append to `ui/src/index.css`:

```css
.action-btn--icon {
  padding: 6px 10px;
  font-size: 16px;
  line-height: 1;
}
.action-btn--active { color: var(--amber); }

.history-thumb__fav {
  position: absolute;
  top: 4px;
  right: 4px;
  color: var(--amber);
  font-size: 11px;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.gallery-filter-chip {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.gallery-filter-chip.active {
  color: var(--amber);
  border-color: var(--amber);
}
```

Also ensure `.history-thumb` has `position: relative;` — check `ui/src/index.css` for the current rule and add if missing.

- [ ] **Step 6.13: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6.14: Manual check**

Run: `npm run dev`. Generate an image, click ★ — UI updates. Refresh — still favorited. Check HistoryStrip for overlay. Open gallery, toggle the filter.

- [ ] **Step 6.15: Commit**

```bash
git add lib/favorite.js tests/favorite.test.js server.js ui/src/types.ts ui/src/lib/api.ts ui/src/store/useAppStore.ts ui/src/components/ResultActions.tsx ui/src/components/HistoryStrip.tsx ui/src/components/GalleryModal.tsx ui/src/index.css
git commit -m "feat(favorites): sidecar-backed favorite flag + star UI + filter

POST /api/history/:filename/favorite toggles a favorite flag on the
sidecar JSON with an atomic tmp+rename write. listImages passes the
flag through. UI: ★ button on the current result, overlay on history
thumbs, filter chip in the gallery, optimistic client update."
```

---

## Task 7: Enhance Prompt

**Files:**
- Create: `lib/enhance.js`
- Create: `tests/enhance-prompt.test.js`
- Create: `ui/src/components/EnhanceModal.tsx`
- Modify: `server.js`
- Modify: `ui/src/lib/api.ts`
- Modify: `ui/src/components/PromptComposer.tsx`
- Modify: `ui/src/index.css`

- [ ] **Step 7.1: Write the failing test**

Create `tests/enhance-prompt.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEnhancePayload, extractEnhancedText } from "../lib/enhance.js";

describe("buildEnhancePayload", () => {
  it("emits a responses-api body with no image tool", () => {
    const body = buildEnhancePayload("셀카 한 장", "ko");
    assert.equal(body.model, "gpt-5.4");
    assert.equal(body.stream, false);
    assert.ok(Array.isArray(body.input));
    assert.ok(!body.tools || body.tools.length === 0);
  });
  it("bakes language hint into the instructions", () => {
    const body = buildEnhancePayload("selfie", "en");
    const sys = body.input.find((m) => m.role === "system");
    assert.ok(sys);
    assert.match(JSON.stringify(sys), /English/);
  });
});

describe("extractEnhancedText", () => {
  it("pulls text from output_text block", () => {
    const raw = {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "자세히 다듬은 프롬프트" }],
        },
      ],
    };
    assert.equal(extractEnhancedText(raw), "자세히 다듬은 프롬프트");
  });
  it("returns null when no text blocks exist", () => {
    assert.equal(extractEnhancedText({ output: [] }), null);
    assert.equal(extractEnhancedText({}), null);
  });
  it("concatenates multiple output_text parts in order", () => {
    const raw = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "첫 번째" },
            { type: "output_text", text: " 두 번째" },
          ],
        },
      ],
    };
    assert.equal(extractEnhancedText(raw), "첫 번째 두 번째");
  });
});
```

- [ ] **Step 7.2: Run test — expect failure**

Run: `node --test tests/enhance-prompt.test.js`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Write `lib/enhance.js`**

```js
const SYSTEM_PROMPT_KO =
  "당신은 이미지 생성 프롬프트 엔지니어입니다. 사용자의 짧은 설명을 받아 구체적이고 세밀한 이미지 생성 프롬프트로 다시 작성하세요. 사용자의 의도와 피사체를 충실히 유지하고, 조명/구도/스타일/무드/렌즈 같은 시각적 세부를 더하세요. 원문이 한국어면 한국어로, 영어면 영어로 답하세요. 면책이나 설명을 추가하지 말고, 새로 작성된 프롬프트 본문만 반환하세요.";

const SYSTEM_PROMPT_EN =
  "You are an image generation prompt engineer. Rewrite the user's short description as a detailed, concrete image prompt. Stay faithful to the subject and intent; add visual specifics for lighting, composition, style, mood, and lens. Respond in Korean if the input is Korean, English if the input is English. Do not add disclaimers or explanations. Return ONLY the rewritten prompt.";

export function buildEnhancePayload(prompt, language) {
  const sys = language === "ko" ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;
  return {
    model: "gpt-5.4",
    stream: false,
    input: [
      { role: "system", content: sys },
      { role: "user", content: prompt },
    ],
    tools: [],
    max_output_tokens: 600,
  };
}

export function extractEnhancedText(raw) {
  if (!raw || !Array.isArray(raw.output)) return null;
  const parts = [];
  for (const item of raw.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") {
          parts.push(c.text);
        }
      }
    }
  }
  if (parts.length === 0) return null;
  return parts.join("");
}
```

- [ ] **Step 7.4: Run test — expect pass**

Run: `node --test tests/enhance-prompt.test.js`
Expected: PASS.

- [ ] **Step 7.5: Wire server route**

Edit `server.js`. Near the other `/api/*` routes, import and add:

```js
import { buildEnhancePayload, extractEnhancedText } from "./lib/enhance.js";

app.post("/api/enhance-prompt", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const language = req.body?.language === "en" ? "en" : "ko";
    if (!prompt) {
      return res.status(400).json({ error: "prompt required", code: "EMPTY_PROMPT" });
    }
    if (prompt.length > 4000) {
      return res.status(400).json({ error: "prompt too long", code: "PROMPT_TOO_LONG" });
    }

    const body = buildEnhancePayload(prompt, language);
    const result = await runResponses({ url: OAUTH_URL, body });
    const text = extractEnhancedText(result.raw);
    if (!text) {
      return res.status(502).json({ error: "enhancer returned no text", code: "ENHANCE_EMPTY" });
    }
    res.json({ prompt: text.trim(), usage: result.usage ?? null });
  } catch (err) {
    console.error("[enhance] error:", err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message, code: "ENHANCE_FAILED" });
  }
});
```

- [ ] **Step 7.6: Add `enhancePrompt` API client**

Edit `ui/src/lib/api.ts`:

```ts
export async function enhancePrompt(prompt: string, language: "ko" | "en" = "ko"): Promise<{ prompt: string }> {
  const res = await fetch("/api/enhance-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, language }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `enhancePrompt failed: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 7.7: Write `<EnhanceModal />`**

Create `ui/src/components/EnhanceModal.tsx`:

```tsx
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  originalPrompt: string;
  onClose: () => void;
  onApply: (newPrompt: string) => void;
  enhancer: (prompt: string) => Promise<string>;
};

export function EnhanceModal({ open, originalPrompt, onClose, onApply, enhancer }: Props) {
  const [enhanced, setEnhanced] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEnhanced("");
    (async () => {
      try {
        const text = await enhancer(originalPrompt);
        if (!cancelled) setEnhanced(text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, originalPrompt, enhancer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="enhance-backdrop" onClick={onClose} role="presentation">
      <div
        className="enhance-modal"
        role="dialog"
        aria-modal="true"
        aria-label="프롬프트 다듬기"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="enhance-modal__header">
          <div className="enhance-modal__title">
            프롬프트 다듬기
            <span className="enhance-modal__badge">OAuth 사용</span>
          </div>
          <button type="button" className="enhance-modal__close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="enhance-modal__body">
          <div className="enhance-col">
            <div className="enhance-col__label">원본</div>
            <div className="enhance-col__text">{originalPrompt}</div>
          </div>
          <div className="enhance-col">
            <div className="enhance-col__label">다듬은 결과</div>
            {loading ? (
              <div className="enhance-col__loading">다듬는 중…</div>
            ) : error ? (
              <div className="enhance-col__error">에러: {error}</div>
            ) : (
              <textarea
                className="enhance-col__edit"
                value={enhanced}
                onChange={(e) => setEnhanced(e.target.value)}
              />
            )}
          </div>
        </div>
        <div className="enhance-modal__foot">
          <button type="button" className="action-btn" onClick={onClose}>취소</button>
          <button
            type="button"
            className="action-btn action-btn--primary"
            disabled={loading || !!error || !enhanced.trim()}
            onClick={() => onApply(enhanced.trim())}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.8: Mount Enhance in PromptComposer**

Edit `ui/src/components/PromptComposer.tsx`. Import and wire:

```tsx
import { useState } from "react";
import { EnhanceModal } from "./EnhanceModal";
import { enhancePrompt as apiEnhance } from "../lib/api";

// Inside the component, after existing hooks:
const [enhanceOpen, setEnhanceOpen] = useState(false);

// Add button in the toolbar, before "현재 결과 사용":
<button
  type="button"
  className="composer__tool"
  onClick={() => prompt.trim() && setEnhanceOpen(true)}
  disabled={!prompt.trim()}
  title="프롬프트 자세히 다듬기"
>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
  <span>다듬기</span>
</button>

// At the end of the composer (but before the closing div), mount the modal:
<EnhanceModal
  open={enhanceOpen}
  originalPrompt={prompt}
  onClose={() => setEnhanceOpen(false)}
  onApply={(next) => { setPrompt(next); setEnhanceOpen(false); }}
  enhancer={async (p) => (await apiEnhance(p, "ko")).prompt}
/>
```

- [ ] **Step 7.9: Add CSS**

Append to `ui/src/index.css`:

```css
.enhance-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}
.enhance-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: min(720px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.enhance-modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.enhance-modal__title {
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}
.enhance-modal__badge {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-dim);
  font-weight: normal;
}
.enhance-modal__close {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
}
.enhance-modal__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 12px 14px;
  overflow: auto;
  min-height: 0;
}
.enhance-col { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.enhance-col__label { font-size: 11px; color: var(--text-dim); }
.enhance-col__text {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  font-size: 13px;
  white-space: pre-wrap;
  overflow: auto;
  flex: 1 1 auto;
}
.enhance-col__edit {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 10px;
  font: inherit;
  font-size: 13px;
  flex: 1 1 auto;
  resize: none;
  min-height: 150px;
}
.enhance-col__loading, .enhance-col__error {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  font-size: 13px;
  color: var(--text-dim);
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.enhance-col__error { color: var(--red); }
.enhance-modal__foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 7.10: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7.11: Manual check**

Run: `npm run dev`. With OAuth connected, type a short prompt, click 다듬기. Modal opens with original + spinner, then enhanced text fills the right column. Edit if desired, click 적용 — the composer prompt is replaced.

- [ ] **Step 7.12: Commit**

```bash
git add lib/enhance.js tests/enhance-prompt.test.js server.js ui/src/lib/api.ts ui/src/components/EnhanceModal.tsx ui/src/components/PromptComposer.tsx ui/src/index.css
git commit -m "feat(enhance): rewrite short prompts via OAuth /api/enhance-prompt

Non-streaming call to the OAuth proxy with tools:[] and a prompt-
engineer system message. Client shows a side-by-side preview modal
with editable output. OAuth-usage badge makes quota consumption
explicit."
```

---

## Task 8: Keyboard Shortcuts + Final Polish

**Files:**
- Modify: `ui/src/components/ShortcutsHelp.tsx`
- Modify: `ui/src/components/PromptComposer.tsx` (E binding)

- [ ] **Step 8.1: Extend shortcut list and handler**

Edit `ui/src/components/ShortcutsHelp.tsx`. Extend `SHORTCUTS`:

```tsx
const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "Enter"], label: "현재 프롬프트로 생성" },
  { keys: ["Ctrl", "K"], label: "프롬프트 입력창 포커스" },
  { keys: ["Ctrl", "G"], label: "갤러리 열기/닫기" },
  { keys: ["Ctrl", "V"], label: "클립보드 이미지를 참조로 추가" },
  { keys: ["V"], label: "현재 결과를 한 장 더 생성(변형)" },
  { keys: ["F"], label: "현재 결과 즐겨찾기 토글" },
  { keys: ["E"], label: "프롬프트 다듬기" },
  { keys: ["?"], label: "이 도움말 열기/닫기" },
  { keys: ["Esc"], label: "열린 모달 닫기" },
];
```

Extend the `onKey` handler inside the same file. Find the existing `const meta = e.metaKey || e.ctrlKey;` area. Add after the existing Cmd/Ctrl+G block:

```tsx
// bare V — vary current result (outside inputs, no modifier)
if (!meta && !e.shiftKey && (e.key === "v" || e.key === "V") && !isTyping) {
  e.preventDefault();
  void useAppStore.getState().varyCurrentResult();
  return;
}

// bare F — toggle favorite on current result (outside inputs)
if (!meta && !e.shiftKey && (e.key === "f" || e.key === "F") && !isTyping) {
  e.preventDefault();
  void useAppStore.getState().toggleFavorite();
  return;
}
```

(Ensure `useAppStore` is imported already — it is.)

- [ ] **Step 8.2: Add E binding inside the composer**

Edit `ui/src/components/PromptComposer.tsx`. Inside the existing `onKeyDown` of the textarea, add:

```tsx
onKeyDown={(e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void generate();
    return;
  }
  if ((e.key === "e" || e.key === "E") && (e.metaKey || e.ctrlKey)) {
    // Ctrl+E in the textarea triggers enhance. (We avoid bare E to not
    // interfere with typing the letter 'e'.)
    e.preventDefault();
    if (prompt.trim()) setEnhanceOpen(true);
  }
}}
```

Also update the shortcut label in Task 8.1 from `["E"]` to `["Ctrl", "E"]`:

```tsx
{ keys: ["Ctrl", "E"], label: "프롬프트 다듬기" },
```

- [ ] **Step 8.3: Build UI**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8.4: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8.5: Full manual walkthrough**

Run: `npm run dev`. Walk through:

1. Three themes × two densities (6 combos) — flip through them.
2. Apply each of 3 built-in presets — settings reflect.
3. Save a custom preset, refresh, confirm it persists.
4. Type a prompt, toggle several chips, generate.
5. Vary the result (click 변형 and press V).
6. Favorite the result (click ★ and press F). Refresh — still favorited.
7. Open gallery, filter by favorite.
8. Enhance a short prompt (Ctrl+E). Apply.
9. Open shortcuts modal (?). All entries visible.

- [ ] **Step 8.6: Commit**

```bash
git add ui/src/components/ShortcutsHelp.tsx ui/src/components/PromptComposer.tsx
git commit -m "feat(ui): expose Vary/Favorite/Enhance shortcuts

Bare V and F bind when focus is outside inputs. Ctrl+E inside the
prompt textarea opens the Enhance modal. Shortcuts help modal lists
all bindings."
```

---

## Self-Review Summary

- **Spec coverage:** All 8 spec parts have corresponding tasks (Parts 1→Task 1, 6+7→Task 2, 2→Task 3, 3→Task 4, 8→Task 5, 5→Task 6, 4→Task 7, shortcuts wrap-up in Task 8).
- **Placeholders:** None — all steps contain real code.
- **Type consistency:** `PresetPayload` is imported where used; `varyCurrentResult` is typed in the store; `GenerateItem.favorite` threaded through types.ts, server mapping, and UI.
- **Ambiguity resolved:** Preset deletion uses a simple name-prompt; "right-click" from the spec is swapped for this simpler interaction (called out in Step 5.4).

## Notes for the executor

- The store file is ~1300 lines. When editing, always Read the surrounding window before Edit to preserve exact formatting.
- Some CSS changes depend on existing selectors; Read the relevant section of `ui/src/index.css` before appending to avoid name collisions.
- The enhance route sends real traffic to the user's OAuth session — keep the default `max_output_tokens` conservative and the system prompt terse.
- Light theme: expect a few hard-coded colors to surface only after flipping. The polish step (2.8) is intentionally scoped to "usable, not pixel-perfect."
