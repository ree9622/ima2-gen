import { useState } from "react";
import { ApiKeyInput } from "./ApiKeyInput";
import { VertexJsonInput } from "./VertexJsonInput";
import { useI18n } from "../i18n";
import type { KeyStatus } from "../hooks/useKeyStatus";

type GeminiKeySectionProps = {
  keyStatus: KeyStatus;
  onSaved: () => void;
};

export function GeminiKeySection({ keyStatus, onSaved }: GeminiKeySectionProps) {
  const { t } = useI18n();
  const vertexConfigured = keyStatus.vertex?.configured ?? false;
  const geminiConfigured = keyStatus.gemini?.configured ?? false;
  const [authMode, setAuthMode] = useState<"apikey" | "vertex">(
    vertexConfigured && !geminiConfigured ? "vertex" : "apikey",
  );

  return (
    <div className="gemini-key-section">
      <div className="gemini-key-section__header">
        <h5>{t("settings.apiKeys.gemini.label")}</h5>
        <select
          value={authMode}
          onChange={(e) => setAuthMode(e.target.value as "apikey" | "vertex")}
          className="gemini-auth-mode-select"
        >
          <option value="apikey">{t("settings.apiKeys.vertex.authModeApiKey")}</option>
          <option value="vertex">{t("settings.apiKeys.vertex.authModeVertex")}</option>
        </select>
      </div>

      {authMode === "apikey" ? (
        <ApiKeyInput
          provider="gemini"
          label=""
          placeholder={t("settings.apiKeys.gemini.placeholder")}
          maskedKey={keyStatus.gemini?.maskedKey ?? null}
          source={keyStatus.gemini?.source ?? "none"}
          configured={geminiConfigured}
          onSaved={onSaved}
        />
      ) : (
        <VertexJsonInput
          configured={vertexConfigured}
          maskedKey={keyStatus.vertex?.maskedKey ?? null}
          source={keyStatus.vertex?.source ?? "none"}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
