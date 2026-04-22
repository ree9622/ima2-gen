import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";

export function GalleryModal() {
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const history = useAppStore((s) => s.history);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="gallery-backdrop" onClick={close} role="presentation">
      <div
        className="gallery"
        role="dialog"
        aria-modal="true"
        aria-label="Image gallery"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gallery__header">
          <div className="gallery__title">Gallery</div>
          <div className="gallery__meta">{history.length} images</div>
          <button
            type="button"
            className="gallery__close"
            onClick={close}
            aria-label="Close gallery"
          >
            ✕
          </button>
        </div>
        <div className="gallery__grid">
          {history.length === 0 ? (
            <div className="gallery__empty">No images yet. Generate something!</div>
          ) : (
            history.map((item, i) => {
              const active = currentImage?.image === item.image;
              return (
                <button
                  key={`${i}-${item.filename ?? i}`}
                  type="button"
                  className={`gallery__tile${active ? " gallery__tile--active" : ""}`}
                  onClick={() => {
                    selectHistory(item);
                    close();
                  }}
                >
                  <img
                    src={item.thumb || item.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
