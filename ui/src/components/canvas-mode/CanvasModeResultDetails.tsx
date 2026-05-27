import { useI18n } from "../../i18n";
import type { GenerateItem } from "../../types";
import { ResultActions } from "../ResultActions";
import { ResultPromptSummary } from "../ResultPromptSummary";

interface CanvasModeResultDetailsProps {
  currentImage: GenerateItem;
  canvasDisplayImage: GenerateItem | null;
  canvasOpen: boolean;
  displayQuality: string | null;
  displaySize: string | null;
  displayModel: string | null;
  onAfterDeleteFocus: () => void;
  onCopyPrompt: () => void;
}

export function CanvasModeResultDetails({
  currentImage,
  canvasDisplayImage,
  canvasOpen,
  displayQuality,
  displaySize,
  displayModel,
  onAfterDeleteFocus,
  onCopyPrompt,
}: CanvasModeResultDetailsProps) {
  const { t } = useI18n();
  const meta = [
    currentImage.elapsed != null ? `${currentImage.elapsed}s` : null,
    currentImage.usage
      ? t("canvas.tokens", { n: currentImage.usage.total_tokens ?? "?" })
      : null,
    displayQuality,
    displaySize,
    displayModel,
    currentImage.provider ?? null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return (
    <>
      <div className="result-meta">{meta}</div>
      <ResultActions
        imageOverride={canvasOpen ? canvasDisplayImage : null}
        onAfterDeleteFocus={onAfterDeleteFocus}
      />
      {currentImage.prompt ? (
        <ResultPromptSummary prompt={currentImage.prompt} onCopy={onCopyPrompt} />
      ) : null}
    </>
  );
}
