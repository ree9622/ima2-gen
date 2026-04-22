import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import type { GenerateItem } from "../types";
import { deleteHistoryItem, restoreHistoryItem, getHistoryGrouped } from "../lib/api";

type TrashPending = {
  filename: string;
  trashId: string;
  item: GenerateItem;
  expiresAt: number;
};

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

type SessionGroup = { sessionId: string; label: string; lastUsedAt: number; items: GenerateItem[] };

export function GalleryModal() {
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const history = useAppStore((s) => s.history);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);
  const removeFromHistory = useAppStore((s) => s.removeFromHistory);
  const addHistoryItem = useAppStore((s) => s.addHistoryItem);

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "session">("date");
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [loose, setLoose] = useState<GenerateItem[]>([]);
  const [pending, setPending] = useState<TrashPending | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPending(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || groupBy !== "session") return;
    let cancelled = false;
    (async () => {
      try {
        const page = await getHistoryGrouped({ limit: 500 });
        if (cancelled) return;
        const toItem = (h: (typeof page.loose)[number]): GenerateItem => ({
          image: h.url,
          url: h.url,
          filename: h.filename,
          prompt: h.prompt,
          size: h.size,
          quality: h.quality,
          provider: h.provider,
          createdAt: h.createdAt,
        });
        setSessionGroups(
          page.sessions.map((s) => ({
            sessionId: s.sessionId,
            label: s.label ?? s.sessionId.slice(0, 8),
            lastUsedAt: s.lastUsedAt,
            items: s.items.map(toItem),
          })),
        );
        setLoose(page.loose.map(toItem));
      } catch {
        // fallback: just use store history
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groupBy]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().normalize("NFC");
    if (!q) return history;
    return history.filter(
      (h) =>
        (h.prompt ?? "").toLowerCase().normalize("NFC").includes(q) ||
        (h.filename ?? "").toLowerCase().normalize("NFC").includes(q),
    );
  }, [history, query]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, GenerateItem[]>();
    for (const item of filtered) {
      const key = dateBucket(item.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // undo countdown tick
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      setPending((cur) => {
        if (!cur) return null;
        if (Date.now() >= cur.expiresAt) return null;
        return { ...cur };
      });
    }, 500);
    return () => clearInterval(id);
  }, [pending]);

  async function handleDelete(item: GenerateItem, e: React.MouseEvent) {
    e.stopPropagation();
    if (!item.filename) return;
    try {
      const r = await deleteHistoryItem(item.filename);
      removeFromHistory(item.filename);
      setPending({
        filename: item.filename,
        trashId: r.trashId,
        item,
        expiresAt: Date.now() + 9500,
      });
    } catch (err) {
      console.error("[gallery] delete failed", err);
    }
  }

  async function handleUndo() {
    if (!pending) return;
    try {
      await restoreHistoryItem(pending.filename, pending.trashId);
      addHistoryItem(pending.item);
    } catch (err) {
      console.error("[gallery] restore failed", err);
    } finally {
      setPending(null);
    }
  }

  if (!open) return null;

  const Tile = (item: GenerateItem, keyPrefix: string, idx: number) => {
    const active = currentImage?.image === item.image;
    return (
      <div
        key={`${keyPrefix}-${idx}-${item.filename ?? idx}`}
        className={`gallery__tile-wrap${active ? " gallery__tile-wrap--active" : ""}`}
      >
        <button
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
        {item.filename && (
          <button
            type="button"
            className="gallery__delete"
            onClick={(e) => handleDelete(item, e)}
            title="Delete (10s undo)"
            aria-label="Delete image"
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  const showSessions = groupBy === "session";
  const totalVisible = showSessions
    ? sessionGroups.reduce((a, g) => a + g.items.length, 0) + loose.length
    : filtered.length;

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
              {totalVisible}
              {query ? ` / ${history.length}` : ""} images
            </div>
            <div className="gallery__group-toggle" role="tablist" aria-label="Group by">
              <button
                type="button"
                role="tab"
                aria-selected={groupBy === "date"}
                className={groupBy === "date" ? "active" : ""}
                onClick={() => setGroupBy("date")}
              >
                Date
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={groupBy === "session"}
                className={groupBy === "session" ? "active" : ""}
                onClick={() => setGroupBy("session")}
              >
                Session
              </button>
            </div>
          </div>
          <input
            type="text"
            className="gallery__search"
            placeholder="Search prompt or filename…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            disabled={showSessions}
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
          {showSessions ? (
            <>
              {sessionGroups.map((g) => (
                <section key={g.sessionId} className="gallery__group">
                  <header className="gallery__group-header">
                    <span className="gallery__group-label">📦 {g.label}</span>
                    <span className="gallery__group-count">{g.items.length}</span>
                  </header>
                  <div className="gallery__grid">
                    {g.items.map((item, i) => Tile(item, g.sessionId, i))}
                  </div>
                </section>
              ))}
              {loose.length > 0 && (
                <section className="gallery__group">
                  <header className="gallery__group-header">
                    <span className="gallery__group-label">Loose images</span>
                    <span className="gallery__group-count">{loose.length}</span>
                  </header>
                  <div className="gallery__grid">
                    {loose.map((item, i) => Tile(item, "loose", i))}
                  </div>
                </section>
              )}
              {sessionGroups.length === 0 && loose.length === 0 && (
                <div className="gallery__empty">No sessions yet.</div>
              )}
            </>
          ) : filtered.length === 0 ? (
            <div className="gallery__empty">
              {history.length === 0
                ? "No images yet. Generate something!"
                : "No matches for that query."}
            </div>
          ) : (
            dateGroups.map(([label, items]) => (
              <section key={label} className="gallery__group">
                <header className="gallery__group-header">
                  <span className="gallery__group-label">{label}</span>
                  <span className="gallery__group-count">{items.length}</span>
                </header>
                <div className="gallery__grid">
                  {items.map((item, i) => Tile(item, label, i))}
                </div>
              </section>
            ))
          )}
        </div>

        {pending && (
          <div className="gallery__undo">
            <span>Deleted {pending.filename}</span>
            <button type="button" onClick={handleUndo}>
              Undo
            </button>
            <span className="gallery__undo-timer">
              {Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000))}s
            </span>
          </div>
        )}
      </div>
    </div>
  );
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
    const q = query.trim().toLowerCase().normalize("NFC");
    if (!q) return history;
    return history.filter(
      (h) =>
        (h.prompt ?? "").toLowerCase().normalize("NFC").includes(q) ||
        (h.filename ?? "").toLowerCase().normalize("NFC").includes(q),
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
