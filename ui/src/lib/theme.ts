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
