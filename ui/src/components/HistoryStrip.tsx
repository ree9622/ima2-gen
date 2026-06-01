import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { handleHorizontalWheel } from "../lib/horizontalWheel";
import { isVideoItem } from "../lib/videoMedia";
import { buildVideoDragPayload } from "../lib/videoContinuity";
import {
  getGalleryItemKey,
  isGalleryVisibleItem,
  uniqueGalleryItems,
} from "../lib/galleryNavigation";

export function HistoryStrip() {
  const history = useAppStore((s) => s.history);
  const currentImage = useAppStore((s) => s.currentImage);
  const historyStripLayout = useAppStore((s) => s.historyStripLayout);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const openGallery = useAppStore((s) => s.openGallery);
  const thumbRefs = useRef<Record<string, HTMLElement | null>>({});
  const { t } = useI18n();
  const activeKey = currentImage ? getGalleryItemKey(currentImage) : null;
  const visibleHistory = useMemo(() => {
    return uniqueGalleryItems(history.filter(isGalleryVisibleItem));
  }, [history]);

  useEffect(() => {
    if (!activeKey) return;
    thumbRefs.current[activeKey]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, visibleHistory]);

  return (
    <div
      className={`history-strip${
        historyStripLayout === "horizontal" ? " history-strip--horizontal" : ""
      }${historyStripLayout === "sidebar" ? " history-strip--sidebar" : ""
      }`}
      onWheel={handleHorizontalWheel}
      data-layout={historyStripLayout}
    >
      <button
        type="button"
        className="history-thumb history-thumb--add"
        onClick={openGallery}
        aria-label={t("history.openGalleryAria")}
        title={t("history.openGalleryTitle")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      {visibleHistory.map((item) => {
        const key = getGalleryItemKey(item);
        const active = activeKey === key;
        if (isVideoItem(item)) {
          return (
            <video
              key={key}
              ref={(node) => {
                thumbRefs.current[key] = node;
              }}
              src={item.url || item.image}
              muted
              playsInline
              preload="metadata"
              className={`history-thumb history-thumb--video${active ? " active" : ""}`}
              onClick={() => selectHistory(item)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/ima2-ref", JSON.stringify(buildVideoDragPayload(item)));
                e.dataTransfer.effectAllowed = "copy";
              }}
            />
          );
        }
        return (
          <img
            key={key}
            ref={(node) => {
              thumbRefs.current[key] = node;
            }}
            src={item.thumb || item.url || item.image}
            alt=""
            className={`history-thumb${active ? " active" : ""}`}
            loading="lazy"
            decoding="async"
            onClick={() => selectHistory(item)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/ima2-ref", JSON.stringify({ image: item.url || item.image, filename: item.filename }));
              e.dataTransfer.effectAllowed = "copy";
            }}
          />
        );
      })}
    </div>
  );
}
