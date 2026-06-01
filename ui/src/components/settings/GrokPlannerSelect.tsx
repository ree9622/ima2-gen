import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";

interface PlannerConfig {
  model: string;
  options: string[];
}

export function GrokPlannerSelect() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PlannerConfig | null>(null);

  useEffect(() => {
    fetch("/api/config/grok-planner")
      .then((r) => r.json() as Promise<PlannerConfig>)
      .then(setConfig)
      .catch(() => {});
  }, []);

  const onChange = async (model: string) => {
    try {
      await fetch("/api/config/grok-planner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setConfig((prev) => prev ? { ...prev, model } : null);
    } catch {}
  };

  if (!config) return null;

  return (
    <article className="settings-row">
      <div className="settings-row__copy">
        <h4>{t("settings.grokPlanner.title")}</h4>
        <p>{t("settings.grokPlanner.body")}</p>
      </div>
      <div className="settings-row__control">
        <select
          value={config.model}
          onChange={(e) => void onChange(e.target.value)}
          aria-label={t("settings.grokPlanner.title")}
        >
          {config.options.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </article>
  );
}
