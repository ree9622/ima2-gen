import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import type { GenerateItem } from "../types";

export function MultimodeSequencePreview() {
  const sequence = useAppStore((s) => {
    const id = s.multimodePreviewFlightId;
    return id ? s.multimodeSequences[id] ?? null : null;
  });
  const cancelMultimode = useAppStore((s) => s.cancelMultimode);
  const canCancelSequence = useAppStore((s) => {
    const id = s.multimodePreviewFlightId;
    return Boolean(id && (s.multimodeAbortControllers[id] || s.inFlight.some((job) => job.id === id)));
  });
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);
  const openCanvas = useAppStore((s) => s.openCanvas);
  const { t } = useI18n();

  const handleSlotClick = (image: GenerateItem) => {
    selectHistory(image);
  };

  const handleSlotDoubleClick = (image: GenerateItem) => {
    selectHistory(image);
    openCanvas();
  };

  if (!sequence) return null;

  const indexedPartials = new Map<number, { image: string; index?: number | null }>();
  const loosePartials = sequence.partials.filter((item) => item.index == null);
  for (const partial of sequence.partials) {
    if (partial.index != null) indexedPartials.set(partial.index, partial);
  }
  const slots = Array.from({ length: sequence.requested }, (_, index) => {
    const image = sequence.images[index];
    const partial = indexedPartials.get(index) ?? (!image ? loosePartials.shift() : undefined);
    return { index, image, partial };
  });

  return (
    <section className="multimode-sequence" aria-live="polite">
      <div className="multimode-sequence__header">
        <div>
          <div className="multimode-sequence__title">{t("multimode.sequenceTitle")}</div>
          <div className="multimode-sequence__meta">
            {t("multimode.sequenceProgress", {
              returned: sequence.returned,
              requested: sequence.requested,
            })}
          </div>
        </div>
        {canCancelSequence ? (
          <button type="button" className="secondary-btn" onClick={cancelMultimode}>
            {t("multimode.cancel")}
          </button>
        ) : null}
      </div>
      <div className={`multimode-sequence__grid count-${Math.min(sequence.requested, 4)}`}>
        {slots.map(({ index, image, partial }) => {
          const isActive =
            image && currentImage?.filename && image.filename === currentImage.filename;
          return (
            <article
              key={image?.filename ?? index}
              className={`multimode-sequence__slot${image ? " done" : ""}${isActive ? " active" : ""}`}
              onClick={image ? () => handleSlotClick(image) : undefined}
              onDoubleClick={image ? () => handleSlotDoubleClick(image) : undefined}
              role={image ? "button" : undefined}
              tabIndex={image ? 0 : undefined}
              onKeyDown={
                image
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSlotClick(image);
                      }
                    }
                  : undefined
              }
            >
              <div className="multimode-sequence__badge">
                {t("multimode.stageLabel", { index: index + 1 })}
              </div>
              {image ? (
                <img src={image.url ?? image.image} alt={t("canvas.resultAlt")} />
              ) : partial ? (
                <img src={partial.image} alt={t("multimode.partialAlt")} />
              ) : (
                <div className="multimode-sequence__empty">
                  {sequence.status === "error"
                    ? t("multimode.error")
                    : sequence.status === "empty"
                      ? t("multimode.empty")
                      : sequence.status === "canceled"
                        ? t("multimode.canceled")
                        : sequence.status === "partial"
                          ? t("multimode.notReturned")
                          : t("multimode.generating")}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
