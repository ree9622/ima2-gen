import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { SavePromptPopover } from "./SavePromptPopover";
import { WebSearchToggle } from "./WebSearchToggle";
import { continueFromItem } from "../lib/continueFromItem";
import { isVideoItem, extractLastFrame } from "../lib/videoMedia";
import type { VideoReferenceDragPayload } from "../lib/videoContinuity";

const MAX_REFS = 5;

type PromptComposerProps = {
  variant?: "sidebar" | "bottom";
};

type InternalRefDragItem = VideoReferenceDragPayload;

function parseCssPixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function PromptComposer({ variant = "sidebar" }: PromptComposerProps) {
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const insertedPrompts = useAppStore((s) => s.insertedPrompts);
  const removeInsertedPrompt = useAppStore((s) => s.removeInsertedPromptFromComposer);
  const moveInsertedPrompt = useAppStore((s) => s.moveInsertedPromptInComposer);
  const generate = useAppStore((s) => s.generate);
  const { t } = useI18n();

  const refs = useAppStore((s) => s.referenceImages);
  const addReferences = useAppStore((s) => s.addReferences);
  const addReferenceDataUrl = useAppStore((s) => s.addReferenceDataUrl);
  const useImageAsReference = useAppStore((s) => s.useImageAsReference);
  const readDroppedImageMetadata = useAppStore((s) => s.readDroppedImageMetadata);
  const removeReference = useAppStore((s) => s.removeReference);
  const currentImage = useAppStore((s) => s.currentImage);
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const selectVideoModel = useAppStore((s) => s.selectVideoModel);
  const setImageModel = useAppStore((s) => s.setImageModel);
  const storyboardActive = useAppStore((s) => s.storyboardActive);
  const toggleStoryboard = useAppStore((s) => s.toggleStoryboard);

  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const promptMode = useAppStore((s) => s.promptMode);
  const setPromptMode = useAppStore((s) => s.setPromptMode);
  const multimode = useAppStore((s) => s.multimode);
  const multimodeMaxImages = useAppStore((s) => s.multimodeMaxImages);
  const isDirectMode = promptMode === "direct";
  const beforePrompts = insertedPrompts.filter((item) => item.placement !== "after");
  const afterPrompts = insertedPrompts.filter((item) => item.placement === "after");
  const visualPromptIds = [
    ...beforePrompts.map((item) => item.id),
    "__main_prompt__",
    ...afterPrompts.map((item) => item.id),
  ];

  const canAddMore = refs.length < MAX_REFS;
  const placeholder = multimode
    ? refs.length > 0
      ? t("multimode.promptPlaceholderWithRefs")
      : t("multimode.promptPlaceholder")
    : refs.length > 0
      ? t("prompt.placeholderWithRefs")
      : t("prompt.placeholder");

  const handleImageFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      const handled = await readDroppedImageMetadata(files[0]);
      if (handled) return;
    }
    await addReferences(files);
  };

  const attachInternalReference = async (item: InternalRefDragItem): Promise<void> => {
    // Add the dragged gallery item as a reference image WITHOUT touching the
    // prompt. Images go through useImageAsReference (fetch → compress → base64);
    // videos extract their last frame. Both produce a proper base64 data URL so
    // downstream generation can decode it.
    try {
      const src = item.url || item.image;
      if (!src) return;
      const refItem = { image: src, url: item.url, filename: item.filename };
      if (isVideoItem(refItem)) {
        const frame = await extractLastFrame(src);
        if (frame) addReferenceDataUrl(frame);
      } else {
        await useImageAsReference(refItem as Parameters<typeof useImageAsReference>[0]);
      }
    } catch { /* non-fatal for drag-drop */ }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    // Internal gallery drag — add as reference only (no prompt injection)
    const refData = e.dataTransfer.getData("application/ima2-ref");
    if (refData) {
      try {
        const item = JSON.parse(refData) as InternalRefDragItem;
        void attachInternalReference(item);
      } catch { /* ignore malformed */ }
      return;
    }
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) void handleImageFiles(files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const extractClipboardImages = (items: DataTransferItemList | null): File[] => {
    if (!items) return [];
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind !== "file") continue;
      if (!it.type.startsWith("image/")) continue;
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    return files;
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!canAddMore) return;
    const files = extractClipboardImages(e.clipboardData?.items ?? null);
    if (files.length === 0) return;
    e.preventDefault();
    const room = MAX_REFS - refs.length;
    void addReferences(files.slice(0, room));
  };

  const maxHeightRef = useRef<number | null>(null);
  const lastVariantRef = useRef(variant);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (maxHeightRef.current === null || lastVariantRef.current !== variant) {
      maxHeightRef.current =
        parseCssPixelValue(window.getComputedStyle(el).maxHeight) ?? 0;
      lastVariantRef.current = variant;
    }
    el.style.height = "auto";
    const maxHeight = maxHeightRef.current;
    const nextHeight = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
    el.style.height = `${nextHeight}px`;
  }, [prompt, variant]);

  useEffect(() => {
    const handler = (e: globalThis.ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      const files = extractClipboardImages(e.clipboardData?.items ?? null);
      if (files.length === 0) return;
      if (refs.length >= MAX_REFS) return;
      e.preventDefault();
      const room = MAX_REFS - refs.length;
      void addReferences(files.slice(0, room));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [refs.length, addReferences]);

  const canMovePromptBlock = (id: string, direction: "up" | "down"): boolean => {
    const index = visualPromptIds.indexOf(id);
    if (index < 0) return false;
    return direction === "up" ? index > 0 : index < visualPromptIds.length - 1;
  };

  const renderPromptChip = (item: typeof insertedPrompts[number]) => (
    <div key={item.id} className="composer__prompt-chip" title={item.name}>
      <span className="composer__prompt-chip-plus" aria-hidden="true">
        +
      </span>
      <span className="composer__prompt-chip-title">{item.name}</span>
      <div className="composer__prompt-chip-actions">
        <button
          type="button"
          className="composer__prompt-chip-move"
          onClick={() => moveInsertedPrompt(item.id, "up")}
          disabled={!canMovePromptBlock(item.id, "up")}
          aria-label={t("prompt.moveBlockUp", { name: item.name })}
          title={t("prompt.moveBlockUp", { name: item.name })}
        >
          ^
        </button>
        <button
          type="button"
          className="composer__prompt-chip-move"
          onClick={() => moveInsertedPrompt(item.id, "down")}
          disabled={!canMovePromptBlock(item.id, "down")}
          aria-label={t("prompt.moveBlockDown", { name: item.name })}
          title={t("prompt.moveBlockDown", { name: item.name })}
        >
          v
        </button>
        <button
          type="button"
          className="composer__prompt-chip-remove"
          onClick={() => removeInsertedPrompt(item.id)}
          aria-label={t("promptLibrary.removeInserted", { name: item.name })}
        >
          x
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`composer composer--${variant}${dragOver ? " composer--drag" : ""}${isDirectMode ? " composer--direct" : ""}${multimode ? " composer--multimode" : ""}${isDirectMode && multimode ? " composer--combined-modes" : ""}`}
      role="group"
      aria-label={
        multimode
          ? t("multimode.composerAriaLabel", { count: multimodeMaxImages })
          : t("prompt.label")
      }
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onPaste={onPaste}
    >
      <div className="composer__header">
        <span className="section-title composer__label">{t("prompt.label")}</span>
        <div className="composer__header-meta">
          {multimode && (
            <span className="composer__mode-badge">
              {t("multimode.composerBadge", { count: multimodeMaxImages })}
            </span>
          )}
          {isDirectMode && (
            <span className="composer__direct-badge">
              {t("prompt.directModeActive")}
            </span>
          )}
          {refs.length > 0 && (
            <span className="composer__count">
              {t("prompt.refCount", { count: refs.length, max: MAX_REFS })}
            </span>
          )}
        </div>
      </div>

      {refs.length > 0 && (
        <div className="composer__chips">
          {refs.map((src, i) => (
            <div key={i} className="composer__chip" title={t("prompt.refChipTitle", { n: i + 1 })}>
              <img src={src} alt={t("prompt.refChipAlt", { n: i + 1 })} loading="lazy" decoding="async" />
              <button
                type="button"
                className="composer__chip-remove"
                onClick={() => removeReference(i)}
                aria-label={t("prompt.refRemoveAria", { n: i + 1 })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {beforePrompts.length > 0 && (
        <div className="composer__prompt-chips">
          {beforePrompts.map(renderPromptChip)}
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="prompt-area composer__textarea"
        value={prompt}
        placeholder={placeholder}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void generate();
          }
        }}
      />

      {afterPrompts.length > 0 && (
        <div className="composer__prompt-chips composer__prompt-chips--after">
          <span className="composer__prompt-chips-label">{t("prompt.afterBlocks")}</span>
          {afterPrompts.map(renderPromptChip)}
        </div>
      )}

      <div className="composer__hint-row">
        <span className="composer__hint">{t("prompt.hint")}</span>
      </div>
      <div className="composer__toolbar">
        <button
          type="button"
          className="composer__tool"
          onClick={() => canAddMore && fileInput.current?.click()}
          disabled={!canAddMore}
          title={t("prompt.attachTitle")}
          aria-label={t("prompt.attachTitle")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => currentImage && void continueFromItem(currentImage).catch(() => {})}
          disabled={!currentImage || !canAddMore}
          title={t("prompt.continueTitle")}
        >
          {t("prompt.continue")}
        </button>
        <button
          type="button"
          className={`composer__tool${videoModelSelected ? " composer__tool--on" : ""}`}
          onClick={() => {
            if (videoModelSelected) {
              setImageModel("gpt-5.5" as any);
            } else {
              selectVideoModel("grok-imagine-video-1.5-preview");
            }
          }}
          title={t("prompt.videoToggleTitle")}
          aria-label={t("prompt.videoToggleTitle")}
          aria-pressed={!!videoModelSelected}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span className="sr-only">Video</span>
        </button>
        <button
          type="button"
          className={`composer__tool${isDirectMode ? " composer__tool--on" : ""}`}
          onClick={() => setPromptMode(isDirectMode ? "auto" : "direct")}
          title={t("prompt.directModeTitle")}
          aria-label={t("prompt.directModeTitle")}
          aria-pressed={isDirectMode}
        >
          <span aria-hidden="true" style={{ fontWeight: 700, fontSize: 11 }}>1:1</span>
        </button>
        <WebSearchToggle variant="compact" />
        <div className="composer__tool-wrap">
          <button
            type="button"
            className="composer__tool composer__tool--full"
            onClick={() => setSaveOpen((v) => !v)}
            disabled={!prompt.trim()}
            title={t("promptLibrary.saveTitle")}
            aria-label={t("promptLibrary.saveTitle")}
          >
            {t("prompt.savePrompt")}
          </button>
          {saveOpen && (
            <SavePromptPopover
              text={prompt}
              mode={promptMode}
              onClose={() => setSaveOpen(false)}
            />
          )}
        </div>
      </div>
      <div className="composer__storyboard-row">
        <button
          type="button"
          className={`composer__tool composer__tool--storyboard${storyboardActive ? " composer__tool--on" : ""}`}
          onClick={toggleStoryboard}
          title={t("prompt.storyboardTitle")}
          aria-pressed={storyboardActive}
        >
          {t("prompt.storyboard")}
        </button>
      </div>

      {dragOver && (
        <div className="composer__dropzone" aria-hidden="true">
          {t("prompt.dropHere", { max: MAX_REFS })}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void handleImageFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
