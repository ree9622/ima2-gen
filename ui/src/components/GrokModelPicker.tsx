import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import type { ImageModel } from "../types";

const GROK_MODELS: Array<{ value: ImageModel; label: string; sub: string }> = [
  { value: "grok-imagine-image", label: "Grok", sub: "Fast" },
  { value: "grok-imagine-image-quality", label: "Grok+", sub: "Best" },
];

export function GrokModelPicker() {
  const { t } = useI18n();
  const imageModel = useAppStore((s) => s.imageModel);
  const setImageModel = useAppStore((s) => s.setImageModel);

  return (
    <div className="option-group">
      <div className="section-title">{t("quality.grokModelTitle")}</div>
      <div className="option-row">
        {GROK_MODELS.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`option-btn${imageModel === m.value ? " active" : ""}`}
            onClick={() => setImageModel(m.value as ImageModel)}
          >
            {m.label}
            <br />
            <span className="option-sub">{m.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
