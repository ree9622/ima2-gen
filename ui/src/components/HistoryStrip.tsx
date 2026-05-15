import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { handleHorizontalWheel } from "../lib/horizontalWheel";
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
  const thumbRefs = useRef<Record<string, HTMLImageElement | null>>({});
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
        return (
          <img
            key={key}
            ref={(node) => {
              thumbRefs.current[key] = node;
            }}
            src={item.thumb || item.url || item.image}
            alt=""
            className={`history-thumb${active ? " active" : ""}`}
            onClick={() => selectHistory(item)}
          />
        );
      })}
    </div>
  );
}
