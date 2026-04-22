import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import type { GenerateItem } from "../types";

function dateBucket(createdAt: number | undefined): string {
  if (!createdAt) return "Older";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "Older";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function GalleryModal() {
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const history = useAppStore((s) => s.history);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);

  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        (h.prompt ?? "").toLowerCase().includes(q) ||
        (h.filename ?? "").toLowerCase().includes(q),
    );
  }, [history, query]);

  const groups = useMemo(() => {
    const map = new Map<string, GenerateItem[]>();
    for (const item of filtered) {
      const key = dateBucket(item.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

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
          <div className="gallery__title-row">
            <div className="gallery__title">Gallery</div>
            <div className="gallery__meta">
              {filtered.length}
              {query ? ` / ${history.length}` : ""} images
            </div>
          </div>
          <input
            type="text"
            className="gallery__search"
            placeholder="Search prompt or filename…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="gallery__close"
            onClick={close}
            aria-label="Close gallery"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="gallery__scroll">
          {filtered.length === 0 ? (
            <div className="gallery__empty">
              {history.length === 0
                ? "No images yet. Generate something!"
                : "No matches for that query."}
            </div>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} className="gallery__group">
                <header className="gallery__group-header">
                  <span className="gallery__group-label">{label}</span>
                  <span className="gallery__group-count">{items.length}</span>
                </header>
                <div className="gallery__grid">
                  {items.map((item, i) => {
                    const active = currentImage?.image === item.image;
                    return (
                      <button
                        key={`${label}-${i}-${item.filename ?? i}`}
                        type="button"
                        className={`gallery__tile${active ? " gallery__tile--active" : ""}`}
                        onClick={() => {
                          selectHistory(item);
                          close();
                        }}
                        title={item.prompt ?? ""}
                      >
                        <img
                          src={item.thumb || item.image}
                          alt={item.prompt ?? ""}
                          loading="lazy"
                          decoding="async"
                        />
                        {item.prompt && (
                          <div className="gallery__caption">
                            <span className="gallery__caption-text">{item.prompt}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
