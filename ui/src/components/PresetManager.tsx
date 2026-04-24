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
      {list.some((p) => !p.builtIn) && (
        <button
          type="button"
          className="preset-manager__delete-hint"
          onClick={() => {
            const name = window.prompt("삭제할 프리셋 이름을 입력하세요");
            if (!name) return;
            const target = list.find((p) => p.name === name.trim() && !p.builtIn);
            if (target) onDelete(target.id);
          }}
        >
          사용자 프리셋 삭제
        </button>
      )}
    </div>
  );
}
