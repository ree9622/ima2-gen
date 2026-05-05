import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import type { GenerateItem } from "../types";
import { deleteHistoryItem, restoreHistoryItem, getHistoryGrouped } from "../lib/api";

type TrashPending = {
  filename: string;
  trashId: string;
  item: GenerateItem;
  expiresAt: number;
};

type SessionGroup = {
  sessionId: string;
  label: string;
  items: GenerateItem[];
};

function dateBucket(createdAt: number | undefined): string {
  if (!createdAt) return "이전";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "이전";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return "이번 주";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const PAGE_SIZE = 50;

// Take items from grouped collections in order until `max` is reached.
// Trailing groups beyond `max` are dropped; the boundary group is sliced.
function takeFirstFromGroups<T>(groups: T[][], max: number): T[][] {
  if (max <= 0) return [];
  const out: T[][] = [];
  let remaining = max;
  for (const g of groups) {
    if (remaining <= 0) break;
    if (g.length <= remaining) {
      out.push(g);
      remaining -= g.length;
    } else {
      out.push(g.slice(0, remaining));
      remaining = 0;
    }
  }
  return out;
}

export function GalleryModal() {
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const history = useAppStore((s) => s.history);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);
  const removeFromHistory = useAppStore((s) => s.removeFromHistory);
  const addHistoryItem = useAppStore((s) => s.addHistoryItem);
  const openLightbox = useAppStore((s) => s.openLightbox);
  const initialFavOnly = useAppStore((s) => s.galleryFavOnly);
  const setGalleryFavOnly = useAppStore((s) => s.setGalleryFavOnly);
  const importHistoryAsRootNode = useAppStore((s) => s.importHistoryAsRootNode);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const graphNodes = useAppStore((s) => s.graphNodes);

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "session">("date");
  const [favOnly, setFavOnly] = useState(initialFavOnly);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [loose, setLoose] = useState<GenerateItem[]>([]);
  const [pending, setPending] = useState<TrashPending | null>(null);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
      setPage(1);
      return;
    }
    // Honor whatever the store says (e.g. HistoryStrip ★ button opened
    // the gallery in favorites-only mode).
    setFavOnly(initialFavOnly);
  }, [open, initialFavOnly]);

  useEffect(() => {
    setGalleryFavOnly(favOnly);
  }, [favOnly, setGalleryFavOnly]);

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
          prompt: h.prompt ?? undefined,
          size: h.size ?? undefined,
          quality: h.quality ?? undefined,
          provider: h.provider,
          createdAt: h.createdAt,
          favorite: h.favorite === true,
        });
        setSessionGroups(
          page.sessions.map((s) => ({
            sessionId: s.sessionId,
            label: s.sessionId.slice(0, 8),
            items: s.items.map(toItem),
          })),
        );
        setLoose(page.loose.map(toItem));
      } catch {
        // Fallback: use current history only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groupBy]);

  const normalizedQuery = useMemo(
    () => query.trim().toLowerCase().normalize("NFC"),
    [query],
  );

  const matchesQuery = useMemo(() => {
    const q = normalizedQuery;
    const textPred = q
      ? (h: GenerateItem) =>
          (h.prompt ?? "").toLowerCase().normalize("NFC").includes(q) ||
          (h.filename ?? "").toLowerCase().normalize("NFC").includes(q)
      : () => true;
    if (!favOnly) return textPred;
    return (h: GenerateItem) => h.favorite === true && textPred(h);
  }, [normalizedQuery, favOnly]);

  // Reset to page 1 whenever the visible result set changes — otherwise a
  // narrow query filtered down to 12 items would still claim "page 5".
  useEffect(() => {
    setPage(1);
  }, [normalizedQuery, favOnly, groupBy]);

  const hasFilter = Boolean(normalizedQuery) || favOnly;

  const filtered = useMemo(() => {
    if (!hasFilter) return history;
    return history.filter(matchesQuery);
  }, [history, hasFilter, matchesQuery]);

  const filteredSessionGroups = useMemo(() => {
    if (!hasFilter) return sessionGroups;
    return sessionGroups
      .map((g) => ({ ...g, items: g.items.filter(matchesQuery) }))
      .filter((g) => g.items.length > 0);
  }, [sessionGroups, hasFilter, matchesQuery]);

  const filteredLoose = useMemo(() => {
    if (!hasFilter) return loose;
    return loose.filter(matchesQuery);
  }, [loose, hasFilter, matchesQuery]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, GenerateItem[]>();
    for (const item of filtered) {
      const key = dateBucket(item.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // ── Pagination (50 per page, infinite scroll) ───────────────────────
  const pageMax = page * PAGE_SIZE;

  const totalAvailable = useMemo(() => {
    if (groupBy === "session") {
      return (
        filteredSessionGroups.reduce((a, g) => a + g.items.length, 0) +
        filteredLoose.length
      );
    }
    return filtered.length;
  }, [groupBy, filteredSessionGroups, filteredLoose, filtered]);

  const dateGroupsPaged = useMemo(
    () =>
      takeFirstFromGroups<GenerateItem>(
        dateGroups.map(([, items]) => items),
        pageMax,
      ).map((items, i) => [dateGroups[i][0], items] as [string, GenerateItem[]]),
    [dateGroups, pageMax],
  );

  const sessionPaged = useMemo(() => {
    if (groupBy !== "session") return { sessionGroups: [], loose: [] as GenerateItem[] };
    const all: GenerateItem[][] = [
      ...filteredSessionGroups.map((g) => g.items),
      filteredLoose,
    ];
    const taken = takeFirstFromGroups<GenerateItem>(all, pageMax);
    const sessionGroups = filteredSessionGroups
      .map((g, i) => ({ ...g, items: taken[i] ?? [] }))
      .filter((g) => g.items.length > 0);
    const looseTaken = taken[filteredSessionGroups.length] ?? [];
    return { sessionGroups, loose: looseTaken };
  }, [groupBy, filteredSessionGroups, filteredLoose, pageMax]);

  const shownCount = Math.min(pageMax, totalAvailable);
  const hasMore = shownCount < totalAvailable;

  useEffect(() => {
    if (!open || !hasMore) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setPage((p) => p + 1);
      },
      { root, threshold: 0, rootMargin: "400px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [open, hasMore, pageMax]);


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

  async function handleDelete(item: GenerateItem, e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!item.filename) return;
    try {
      const r = await deleteHistoryItem(item.filename);
      removeFromHistory(item.filename);
      // 서버는 markNodesAssetMissing으로 status만 'asset-missing'으로 바꾸지
      // 노드 자체를 지우진 않는다. 사용자 기대는 "이미지 지우면 노드도
      // 사라진다" — 현재 활성 세션의 그래프에서 매칭되는 노드를 즉시 제거.
      // (다른 세션의 노드는 store에 없어 이 호출이 noop이라 안전.)
      const cid = item.clientNodeId;
      if (cid && graphNodes.some((n) => n.id === cid)) {
        deleteNode(cid as never);
      }
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

  const renderTile = (item: GenerateItem, keyPrefix: string, idx: number) => {
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
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            selectHistory(item);
            close();
            openLightbox(item.filename ?? null);
          }}
          title={`${item.prompt ?? ""}${item.prompt ? "\n" : ""}더블클릭: 전체 보기`}
        >
          <img src={item.thumb || item.image} alt={item.prompt ?? "생성 이미지"} loading="lazy" decoding="async" />
          {item.prompt && (
            <div className="gallery__caption">
              <span className="gallery__caption-text">{item.prompt}</span>
            </div>
          )}
        </button>
        <button
          type="button"
          className="gallery__expand"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            selectHistory(item);
            close();
            openLightbox(item.filename ?? null);
          }}
          title="전체 보기"
          aria-label="전체 보기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        {item.filename && (
          <button
            type="button"
            className="gallery__send-to-node"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const result = await importHistoryAsRootNode(item);
              if (result) close();
            }}
            title="노드 캔버스로 보내기"
            aria-label="노드 캔버스로 보내기"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <circle cx="18" cy="6" r="3" />
              <line x1="9" y1="6" x2="15" y2="6" />
              <line x1="18" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        )}
        {item.filename && (
          <button
            type="button"
            className="gallery__delete"
            onClick={(e) => handleDelete(item, e)}
            title="삭제 (10초 내 복구 가능)"
            aria-label="이미지 삭제"
          >
            ×
          </button>
        )}
      </div>
    );
  };

  const showSessions = groupBy === "session";

  return (
    <div className="gallery-backdrop" onClick={close} role="presentation">
      <div
        className="gallery"
        role="dialog"
        aria-modal="true"
        aria-label="이미지 갤러리"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gallery__header">
          <div className="gallery__title-row">
            <div className="gallery__title">갤러리</div>
            <div className="gallery__meta">
              표시 {shownCount} / 전체 {totalAvailable}장
              {hasFilter ? ` (필터 적용, 전체 ${history.length}장 중)` : ""}
            </div>
            <div className="gallery__group-toggle" role="tablist" aria-label="정렬 기준">
              <button
                type="button"
                role="tab"
                aria-selected={groupBy === "date"}
                className={groupBy === "date" ? "active" : ""}
                onClick={() => setGroupBy("date")}
              >
                날짜
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={groupBy === "session"}
                className={groupBy === "session" ? "active" : ""}
                onClick={() => setGroupBy("session")}
              >
                세션
              </button>
            </div>
          </div>
          <input
            type="text"
            className="gallery__search"
            placeholder="프롬프트나 파일명을 검색 (Esc로 닫기)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className={`gallery-filter-chip${favOnly ? " active" : ""}`}
            onClick={() => setFavOnly((v) => !v)}
            title="즐겨찾기만 보기"
            aria-pressed={favOnly}
          >
            ★ 즐겨찾기
          </button>
          <button
            type="button"
            className="gallery__close"
            onClick={close}
            aria-label="갤러리 닫기"
            title="닫기 (Esc)"
          >
            ×
          </button>
        </div>

        <div className="gallery__scroll" ref={scrollRef}>
          {showSessions ? (
            <>
              {sessionPaged.sessionGroups.map((g) => (
                <section key={g.sessionId} className="gallery__group">
                  <header className="gallery__group-header">
                    <span className="gallery__group-label">세션 {g.label}</span>
                    <span className="gallery__group-count">{g.items.length}</span>
                  </header>
                  <div className="gallery__grid">
                    {g.items.map((item, i) => renderTile(item, g.sessionId, i))}
                  </div>
                </section>
              ))}
              {sessionPaged.loose.length > 0 && (
                <section className="gallery__group">
                  <header className="gallery__group-header">
                    <span className="gallery__group-label">독립 이미지</span>
                    <span className="gallery__group-count">{sessionPaged.loose.length}</span>
                  </header>
                  <div className="gallery__grid">
                    {sessionPaged.loose.map((item, i) => renderTile(item, "loose", i))}
                  </div>
                </section>
              )}
              {sessionPaged.sessionGroups.length === 0 && sessionPaged.loose.length === 0 && (
                <div className="gallery__empty">
                  {hasFilter
                    ? "검색 결과가 없습니다."
                    : "아직 저장된 세션이 없습니다."}
                </div>
              )}
            </>
          ) : filtered.length === 0 ? (
            <div className="gallery__empty">
              {history.length === 0
                ? "아직 생성된 이미지가 없습니다. 먼저 하나 만들어보세요."
                : hasFilter
                  ? "검색 결과가 없습니다."
                  : "아직 생성된 이미지가 없습니다."}
            </div>
          ) : (
            dateGroupsPaged.map(([label, items]) => (
              <section key={label} className="gallery__group">
                <header className="gallery__group-header">
                  <span className="gallery__group-label">{label}</span>
                  <span className="gallery__group-count">{items.length}</span>
                </header>
                <div className="gallery__grid">
                  {items.map((item, i) => renderTile(item, label, i))}
                </div>
              </section>
            ))
          )}
          {hasMore && (
            <div ref={sentinelRef} className="gallery__sentinel" aria-hidden="true">
              <button
                type="button"
                className="gallery__load-more"
                onClick={() => setPage((p) => p + 1)}
              >
                더 보기 (+{Math.min(PAGE_SIZE, totalAvailable - shownCount)}장)
              </button>
            </div>
          )}
        </div>

        {pending && (
          <div className="gallery__undo">
            <span>삭제됨: {pending.filename}</span>
            <button type="button" onClick={handleUndo}>
              되돌리기
            </button>
            <span className="gallery__undo-timer">
              {Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000))}초
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
