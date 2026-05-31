import {
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useAppStore } from "../store/useAppStore";
import { useCreateBlankCanvas } from "../hooks/useCreateBlankCanvas";
import { ResultActions } from "./ResultActions";
import { ResultPromptSummary } from "./ResultPromptSummary";
import { MultimodeSequencePreview } from "./MultimodeSequencePreview";
import { ViewerControls } from "./viewer/ViewerControls";
import { useI18n } from "../i18n";
import { isEditableTarget } from "../lib/domEvents";
import { getImageModelShortLabel } from "../lib/imageModels";
import { isVideoItem } from "../lib/videoMedia";
import { formatReasoningLabel } from "../lib/reasoning";
import type { GenerateItem } from "../types";
import {
  useViewerTransform,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
} from "../hooks/useViewerTransform";

const LazyCanvasModeWorkspace = lazy(() =>
  import("./canvas-mode").then((module) => ({
    default: module.CanvasModeWorkspace,
  })),
);

function formatQualityAlias(quality: string | null | undefined): string | null {
  if (quality === "low") return "l";
  if (quality === "medium") return "m";
  if (quality === "high") return "h";
  return quality ?? null;
}

function formatSizeAlias(size: string | null | undefined): string | null {
  if (!size) return null;
  const square = size.match(/^(\d+)x\1$/);
  if (square) return `${square[1]}²`;
  return size.replace("x", "×");
}

function getClassicImageSrc(image: GenerateItem): string {
  const src = image.url ?? image.image;
  if (!image.canvasVersion || !image.canvasMergedAt || src.startsWith("data:")) return src;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}canvasMergedAt=${image.canvasMergedAt}`;
}

export function Canvas() {
  const currentImage = useAppStore((s) => s.currentImage);
  const importLocalImageToHistory = useAppStore((s) => s.importLocalImageToHistory);
  const multimodeSequence = useAppStore((s) => {
    const id = s.multimodePreviewFlightId;
    return id ? s.multimodeSequences[id] ?? null : null;
  });
  const selectHistoryShortcutTarget = useAppStore((s) => s.selectHistoryShortcutTarget);
  const trashHistoryItem = useAppStore((s) => s.trashHistoryItem);
  const permanentlyDeleteHistoryItemByShortcut = useAppStore(
    (s) => s.permanentlyDeleteHistoryItemByShortcut,
  );
  const markGeneratedResultsSeen = useAppStore((s) => s.markGeneratedResultsSeen);
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const quality = useAppStore((s) => s.quality);
  const getResolvedSize = useAppStore((s) => s.getResolvedSize);
  const canvasOpen = useAppStore((s) => s.canvasOpen);
  const openCanvas = useAppStore((s) => s.openCanvas);
  const showToast = useAppStore((s) => s.showToast);
  const { t } = useI18n();
  const [dropActive, setDropActive] = useState(false);
  const { creatingBlankCanvas, createBlankCanvas } = useCreateBlankCanvas();
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const imageKey = currentImage
    ? `${currentImage.filename ?? currentImage.url ?? currentImage.image}:${currentImage.canvasMergedAt ?? ""}`
    : null;
  const viewer = useViewerTransform(imageKey);

  const copyPrompt = (): void => {
    if (!currentImage?.prompt) return;
    void navigator.clipboard.writeText(currentImage.prompt);
    showToast(t("toast.promptCopied"));
  };

  const handleViewerKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!currentImage) return;
      if (event.target !== event.currentTarget) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) {
        void permanentlyDeleteHistoryItemByShortcut(currentImage);
        return;
      }
      void trashHistoryItem(currentImage);
      return;
    }

    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) return;
    if (event.target !== event.currentTarget) return;
    if (isEditableTarget(event.target)) return;

    event.preventDefault();
    if (event.key === "ArrowLeft") selectHistoryShortcutTarget("previous");
    else if (event.key === "ArrowRight") selectHistoryShortcutTarget("next");
    else if (event.key === "Home") selectHistoryShortcutTarget("first");
    else if (event.key === "End") selectHistoryShortcutTarget("last");
  };

  const handleViewerMouseDown = (event: MouseEvent<HTMLElement>): void => {
    if (isEditableTarget(event.target)) return;
    markGeneratedResultsSeen();
    event.currentTarget.focus();
  };

  const restoreResultFocus = useCallback((): void => {
    window.requestAnimationFrame(() => resultContainerRef.current?.focus());
  }, []);

  const handleCenterDragOver = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDropActive((prev) => (prev ? prev : true));
  }, []);

  const handleCenterDragLeave = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleCenterDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>): Promise<void> => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDropActive(false);
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        /^image\/(png|jpeg|webp)$/.test(file.type),
      );
      if (files.length === 0) return;
      await importLocalImageToHistory(files[0]);
    },
    [importLocalImageToHistory],
  );

  if (canvasOpen && currentImage) {
    return (
      <Suspense fallback={<main className="canvas canvas--mode-open" aria-busy="true" />}>
        <LazyCanvasModeWorkspace currentImage={currentImage} />
      </Suspense>
    );
  }

  const displayQuality = formatQualityAlias(currentImage?.quality ?? quality);
  const displaySize = formatSizeAlias(currentImage?.size ?? getResolvedSize());
  const displayModel = getImageModelShortLabel(currentImage?.model);
  const imageSrc = currentImage ? getClassicImageSrc(currentImage) : null;

  return (
    <main
      className={`canvas${dropActive ? " canvas--drop-active" : ""}`}
      onDragOver={handleCenterDragOver}
      onDragLeave={handleCenterDragLeave}
      onDrop={handleCenterDrop}
    >
      {dropActive ? (
        <div className="canvas__drop-overlay" aria-hidden>
          <span className="canvas__drop-hint">{t("canvas.drop.hint")}</span>
        </div>
      ) : null}
      <div className={`progress-bar${activeGenerations > 0 ? " active" : ""}`} />
      {multimodeSequence ? (
        <MultimodeSequencePreview />
      ) : currentImage && imageSrc ? (
        <div
          ref={resultContainerRef}
          className="result-container visible"
          tabIndex={0}
          onMouseDown={handleViewerMouseDown}
          onKeyDown={handleViewerKeyDown}
          aria-label={t("canvas.imageViewerAria")}
        >
          <div
            className={`result-preview-frame canvas-annotation-frame${viewer.zoom > VIEWER_MIN_ZOOM ? " canvas-annotation-frame--zoomed" : ""}`}
            onWheel={viewer.handleWheel}
            onDoubleClick={viewer.handleDoubleClick}
            onPointerDown={viewer.handlePointerDown}
            onPointerMove={viewer.handlePointerMove}
            onPointerUp={viewer.handlePointerUp}
            onPointerCancel={viewer.handlePointerUp}
          >
            {isVideoItem(currentImage) ? (
              <video
                className="result-img"
                key={imageKey ?? undefined}
                src={imageSrc}
                controls
                autoPlay
                loop
                playsInline
                style={{
                  transform: `translate(${viewer.pan.x}px, ${viewer.pan.y}px) scale(${viewer.zoom})`,
                }}
              />
            ) : (
              <img
                className="result-img"
                key={imageKey ?? undefined}
                src={imageSrc}
                alt={t("canvas.resultAlt")}
                decoding="async"
                style={{
                  transform: `translate(${viewer.pan.x}px, ${viewer.pan.y}px) scale(${viewer.zoom})`,
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  openCanvas();
                }}
              />
            )}
            <ViewerControls
              zoom={viewer.zoom}
              minZoom={VIEWER_MIN_ZOOM}
              maxZoom={VIEWER_MAX_ZOOM}
              onZoomIn={viewer.zoomIn}
              onZoomOut={viewer.zoomOut}
              onReset={viewer.reset}
              labels={{
                controls: t("viewer.controls"),
                zoomIn: t("viewer.zoomIn"),
                zoomOut: t("viewer.zoomOut"),
                reset: t("viewer.reset"),
              }}
            />
          </div>
          <div className="result-meta">
            {(isVideoItem(currentImage)
              ? [
                  currentImage.elapsed != null ? `${currentImage.elapsed}s` : null,
                  (currentImage as any).video?.duration ? `${(currentImage as any).video.duration}s clip` : null,
                  (currentImage as any).video?.resolution ?? null,
                  (currentImage as any).video?.aspectRatio ?? null,
                  displayModel,
                  currentImage.provider ?? null,
                ]
              : [
                  currentImage.elapsed != null ? `${currentImage.elapsed}s` : null,
                  currentImage.usage
                    ? t("canvas.tokens", { n: currentImage.usage.total_tokens ?? "?" })
                    : null,
                  formatReasoningLabel(currentImage.reasoningEffort),
                  displayQuality,
                  displaySize,
                  displayModel,
                  currentImage.provider ?? null,
                ]
            )
              .filter((value): value is string => Boolean(value))
              .join(" · ")}
          </div>
          <ResultActions onAfterDeleteFocus={restoreResultFocus} />
          {currentImage.prompt ? (
            <ResultPromptSummary prompt={currentImage.prompt} onCopy={copyPrompt} />
          ) : null}
        </div>
      ) : !currentImage ? (
        <div className="canvas__blank-entry">
          <div className="canvas__blank-sheet" aria-hidden />
          <div className="canvas__blank-copy">
            <strong>{t("canvas.blank.title")}</strong>
            <span>{t("canvas.blank.subtitle")}</span>
          </div>
          <button
            type="button"
            className="canvas__blank-button"
            onClick={() => void createBlankCanvas()}
            disabled={creatingBlankCanvas}
          >
            {creatingBlankCanvas ? t("canvas.blank.creating") : t("canvas.blank.create")}
          </button>
        </div>
      ) : null}
    </main>
  );
}
