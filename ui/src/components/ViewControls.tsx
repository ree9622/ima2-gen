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
