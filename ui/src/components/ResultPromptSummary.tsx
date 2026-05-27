import { type KeyboardEvent } from "react";
import { useI18n } from "../i18n";

interface ResultPromptSummaryProps {
  prompt: string;
  onCopy: () => void;
}

export function ResultPromptSummary({ prompt, onCopy }: ResultPromptSummaryProps) {
  const { t } = useI18n();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCopy();
    }
  };

  return (
    <div
      className="result-prompt"
      onClick={onCopy}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title={t("result.copyPrompt")}
      aria-label={t("result.copyPrompt")}
    >
      <span className="result-prompt__text">{prompt}</span>
    </div>
  );
}
