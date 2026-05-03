import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { deleteHistoryItem, restoreHistoryItem } from "../lib/api";
import type { GenerateItem } from "../types";

type ZoomMode = "fit" | "actual";

const SWIPE_THRESHOLD_PX = 50;
const UNDO_WINDOW_MS = 8000;

export function Lightbox() {
  const open = useAppStore((s) => s.lightboxOpen);
  const close = useAppStore((s) => s.closeLightbox);
  const next = useAppStore((s) => s.lightboxNext);
  const prev = useAppStore((s) => s.lightboxPrev);
  const currentImage = useAppStore((s) => s.currentImage);
  const history = useAppStore((s) => s.history);
  const showToast = useAppStore((s) => s.showToast);
  const removeFromHistory = useAppStore((s) => s.removeFromHistory);
  const addHistoryItem = useAppStore((s) => s.addHistoryItem);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const jumpToImageSession = useAppStore((s) => s.jumpToImageSession);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const importHistoryAsRootNode = useAppStore((s) => s.importHistoryAsRootNode);
  const deleteNodesByFilename = useAppStore((s) => s.deleteNodesByFilename);
  const flushGraphSave = useAppStore((s) => s.flushGraphSave);

  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [showCaption, setShowCaption] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("ima2.lightbox.caption");
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const [pendingUndo, setPendingUndo] = useState<{
    filename: string;
    trashId: string;
    item: GenerateItem;
    expiresAt: number;
  } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const toggleCaption = useCallback(() => {
    setShowCaption((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ima2.lightbox.caption", nv ? "1" : "0");
      } catch {}
      return nv;
    });
  }, []);

  // Reset zoom whenever the displayed image changes.
  useEffect(() => {
    setZoom("fit");
  }, [currentImage?.filename, currentImage?.url]);

  // Keyboard: ESC closes, arrows navigate, Space toggles zoom, H hides caption,
  // Delete/Backspace removes the current image.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setZoom((z) => (z === "fit" ? "actual" : "fit"));
        return;
      }
      if (e.key === "h" || e.key === "H" || e.key === "ㅗ") {
        e.preventDefault();
        toggleCaption();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (e.shiftKey) {
          void handleDeleteWithNodes();
        } else {
          void handleDelete();
        }
        return;
      }
      if (e.key === "f" || e.key === "F" || e.key === "ㄹ") {
        e.preventDefault();
        void toggleFavorite();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleDelete / handleDeleteWithNodes / toggleCaption / toggleFavorite are stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, next, prev, toggleCaption, toggleFavorite]);

  // Lock background scroll while open. Body already has overflow:hidden, but
  // some mobile browsers still bounce — set inert + aria-hidden on the app
  // shell instead would be cleaner, but the existing layout already handles
  // it via z-index 200. This is a no-op safeguard.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) close();
    },
    [close],
  );

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      // Horizontal-dominant swipe → navigate. Vertical-dominant → close.
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD_PX) {
        if (dx < 0) next();
        else prev();
        return;
      }
      if (Math.abs(dy) > SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
        close();
      }
    },
    [next, prev, close],
  );

  // Soft-delete the displayed image, jump to the neighbour, surface an undo
  // banner. Exits the lightbox if no neighbours remain.
  const handleDelete = useCallback(async () => {
    const cur = useAppStore.getState().currentImage;
    if (!cur || !cur.filename) return;
    const filename = cur.filename;
    const hist = useAppStore.getState().history;
    const idx = hist.findIndex((h) => h.filename === filename);
    const neighbour = idx >= 0 ? hist[idx + 1] ?? hist[idx - 1] ?? null : null;
    try {
      const r = await deleteHistoryItem(filename);
      removeFromHistory(filename);
      setPendingUndo({
        filename,
        trashId: r.trashId,
        item: cur,
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      });
      if (neighbour) {
        selectHistory(neighbour);
      } else {
        close();
      }
    } catch (err) {
      console.warn("[ima2:lightbox] delete failed", err);
      showToast("삭제에 실패했습니다", true);
    }
  }, [close, removeFromHistory, selectHistory, showToast]);

  // Shift+Delete (or Shift-click on the trash button): cascade — also remove
  // every graph node whose imageUrl matches this filename, not just the
  // image asset. Order matters: persist the node removal BEFORE the asset
  // trash, otherwise the server's markNodesAssetMissing bumps graph_version
  // first and the 409 reload would re-introduce the deleted nodes as
  // "asset-missing" placeholders.
  const handleDeleteWithNodes = useCallback(async () => {
    const cur = useAppStore.getState().currentImage;
    if (!cur || !cur.filename) return;
    const filename = cur.filename;
    const nodeCount = deleteNodesByFilename(filename);
    if (nodeCount > 0) {
      try {
        await flushGraphSave("delete-with-nodes");
      } catch (err) {
        console.warn("[ima2:lightbox] flushGraphSave before cascade delete failed", err);
      }
    }
    await handleDelete();
  }, [deleteNodesByFilename, flushGraphSave, handleDelete]);

  const handleUndo = useCallback(async () => {
    const p = pendingUndo;
    if (!p) return;
    try {
      await restoreHistoryItem(p.filename, p.trashId);
      addHistoryItem(p.item);
      setPendingUndo(null);
      selectHistory(p.item);
    } catch (err) {
      console.warn("[ima2:lightbox] restore failed", err);
      showToast("되돌리기에 실패했습니다", true);
    }
  }, [pendingUndo, addHistoryItem, selectHistory, showToast]);

  // Auto-clear undo banner once the trash TTL elapses.
  useEffect(() => {
    if (!pendingUndo) return;
    const id = window.setInterval(() => {
      setPendingUndo((cur) => {
        if (!cur) return null;
        if (Date.now() >= cur.expiresAt) return null;
        return { ...cur };
      });
    }, 500);
    return () => clearInterval(id);
  }, [pendingUndo]);

  const sendToNode = useCallback(async () => {
    if (!currentImage) return;
    const result = await importHistoryAsRootNode(currentImage);
    if (result) close();
  }, [currentImage, importHistoryAsRootNode, close]);

  const download = useCallback(async () => {
    if (!currentImage) return;
    const src = currentImage.url || currentImage.image;
    if (!src) return;
    try {
      const a = document.createElement("a");
      a.href = src;
      a.download = currentImage.filename || `image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.warn("[ima2:lightbox] download failed", err);
      showToast("다운로드에 실패했습니다", true);
    }
  }, [currentImage, showToast]);

  if (!open || !currentImage) return null;

  const src = currentImage.url || currentImage.image;
  const idx = history.findIndex(
    (h) =>
      (currentImage.filename && h.filename === currentImage.filename) ||
      h.image === currentImage.image,
  );
  const total = history.length;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < total - 1;
  const counter = idx >= 0 ? `${idx + 1} / ${total}` : null;

  return (
    <div
      className={`lightbox lightbox--${zoom}`}
      role="dialog"
      aria-modal="true"
      aria-label="이미지 전체 보기"
      onClick={onBackdropClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="lightbox__topbar">
        {counter ? <span className="lightbox__counter">{counter}</span> : <span />}
        <div className="lightbox__actions">
          {currentImage.filename ? (
            <button
              type="button"
              className={`lightbox__btn lightbox__btn--fav${currentImage.favorite ? " is-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                void toggleFavorite();
              }}
              aria-pressed={currentImage.favorite === true}
              aria-label={currentImage.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
              title={currentImage.favorite ? "즐겨찾기 해제 (F)" : "즐겨찾기 (F)"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={currentImage.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className={`lightbox__btn${showCaption ? "" : " lightbox__btn--off"}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleCaption();
            }}
            aria-pressed={!showCaption}
            aria-label={showCaption ? "프롬프트·참조사진 숨기기" : "프롬프트·참조사진 보기"}
            title={showCaption ? "프롬프트·참조사진 숨기기 (H)" : "프롬프트·참조사진 보기 (H)"}
          >
            {showCaption ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="lightbox__btn"
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => (z === "fit" ? "actual" : "fit"));
            }}
            aria-label={zoom === "fit" ? "원본 크기로 보기" : "화면에 맞추기"}
            title={zoom === "fit" ? "원본 크기 (Space)" : "화면에 맞춤 (Space)"}
          >
            {zoom === "fit" ? "100%" : "맞춤"}
          </button>
          {currentImage.filename ? (
            <button
              type="button"
              className="lightbox__btn"
              onClick={(e) => {
                e.stopPropagation();
                void sendToNode();
              }}
              aria-label="노드 캔버스로 보내기"
              title="노드 캔버스로 보내기"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <circle cx="18" cy="6" r="3" />
                <line x1="9" y1="6" x2="15" y2="6" />
                <line x1="18" y1="9" x2="18" y2="15" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="lightbox__btn"
            onClick={(e) => {
              e.stopPropagation();
              void download();
            }}
            aria-label="다운로드"
            title="다운로드"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {currentImage.filename ? (
            <button
              type="button"
              className="lightbox__btn"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  showToast("이 이미지의 URL을 복사했어요");
                } catch {
                  showToast("URL 복사에 실패했어요", true);
                }
              }}
              aria-label="이미지 URL 복사"
              title="이 이미지로 바로 가는 URL 복사"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>
          ) : null}
          {currentImage.filename ? (
            <button
              type="button"
              className="lightbox__btn lightbox__btn--danger"
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) {
                  void handleDeleteWithNodes();
                } else {
                  void handleDelete();
                }
              }}
              aria-label="삭제"
              title="삭제 — Delete: 이미지만 / Shift+Delete: 매칭 노드까지"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="lightbox__btn lightbox__btn--close"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            aria-label="닫기"
            title="닫기 (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {hasPrev ? (
        <button
          type="button"
          className="lightbox__nav lightbox__nav--prev"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="이전 이미지"
          title="이전 (←)"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className="lightbox__nav lightbox__nav--next"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="다음 이미지"
          title="다음 (→)"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      ) : null}

      <div
        className="lightbox__stage"
        onClick={(e) => {
          // Image click jumps to the originating session; clicks on empty
          // stage area still bubble to the backdrop and close.
          if ((e.target as HTMLElement).tagName === "IMG") {
            e.stopPropagation();
            void jumpToImageSession();
          }
        }}
      >
        <img
          className="lightbox__img"
          src={src}
          alt={currentImage.prompt ?? "전체 보기"}
          draggable={false}
          title="클릭: 이 이미지로 재작업 (프롬프트·옵션 가져오기) · Space: 100%/맞춤"
        />
      </div>

      {currentImage.codexAccount ? (
        <div className="lightbox__account" title="이 이미지를 만든 codex 계정"
             style={{position:"absolute",top:8,right:8,padding:"3px 8px",borderRadius:5,
                     background:"rgba(0,0,0,.55)",color:"#fff",fontSize:11,letterSpacing:0,
                     pointerEvents:"none"}}>acc: {currentImage.codexAccount}</div>
      ) : null}
      {currentImage.prompt && showCaption ? (
        <div className="lightbox__caption" onClick={(e) => e.stopPropagation()}>
          <span className="lightbox__caption-text">{currentImage.prompt}</span>
        </div>
      ) : null}

      {currentImage.references && currentImage.references.length > 0 && showCaption ? (
        <div className="lightbox__refs" onClick={(e) => e.stopPropagation()}>
          <span className="lightbox__refs-label">참조 사진</span>
          <div className="lightbox__refs-row">
            {currentImage.references.map((ref) => {
              const clickable = ref.kind === "history" && !!ref.filename;
              const title = clickable
                ? `이 참조 이미지로 이동 (${ref.filename})`
                : "외부 업로드 참조 이미지";
              return (
                <button
                  key={ref.hash}
                  type="button"
                  className={`lightbox__ref-thumb${clickable ? " is-clickable" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (clickable && ref.filename) {
                      useAppStore.getState().openLightbox(ref.filename);
                    }
                  }}
                  disabled={!clickable}
                  title={title}
                >
                  <img src={ref.sourceUrl} alt="참조 이미지" loading="lazy" />
                  {ref.kind === "uploaded" ? (
                    <span className="lightbox__ref-tag" aria-label="외부 업로드">📎</span>
                  ) : (
                    <span className="lightbox__ref-tag is-history" aria-label="히스토리에서 가져옴">↗</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {pendingUndo ? (
        <div className="lightbox__undo" onClick={(e) => e.stopPropagation()}>
          <span>삭제됨</span>
          <button
            type="button"
            className="lightbox__undo-btn"
            onClick={(e) => {
              e.stopPropagation();
              void handleUndo();
            }}
          >
            되돌리기
          </button>
          <span className="lightbox__undo-timer">
            {Math.max(0, Math.ceil((pendingUndo.expiresAt - Date.now()) / 1000))}초
          </span>
        </div>
      ) : null}
    </div>
  );
}
