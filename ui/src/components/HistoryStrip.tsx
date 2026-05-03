import { useAppStore } from "../store/useAppStore";

function formatRelative(ts: number | undefined): string {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(ts).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

function buildTooltip(item: {
  prompt?: string;
  createdAt?: number;
  quality?: string;
  size?: string;
  codexAccount?: string | null;
}): string {
  const head = item.prompt ? item.prompt.slice(0, 80) : "이미지";
  const meta = [
    formatRelative(item.createdAt),
    item.quality,
    item.size,
    item.codexAccount ? `acc:${item.codexAccount}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return meta ? `${head}\n${meta}` : head;
}

export function HistoryStrip() {
  const history = useAppStore((s) => s.history);
  const currentImage = useAppStore((s) => s.currentImage);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const openLightbox = useAppStore((s) => s.openLightbox);
  const openGallery = useAppStore((s) => s.openGallery);

  const favCount = history.filter((h) => h.favorite).length;
  return (
    <div className="history-strip">
      <button
        type="button"
        className="history-thumb history-thumb--add"
        onClick={() => openGallery()}
        aria-label="갤러리 열기"
        title={`전체 갤러리 (${history.length}장)`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        className="history-thumb history-thumb--fav"
        onClick={() => openGallery({ favOnly: true })}
        aria-label="즐겨찾기만 보기"
        title={`즐겨찾기 (${favCount}장)`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
      {history.map((item, i) => {
        const active = item.filename
          ? currentImage?.filename === item.filename
          : currentImage?.image === item.image;
        return (
          <button
            type="button"
            key={item.filename ?? `${i}-${item.image}`}
            className={`history-thumb${active ? " active" : ""}`}
            onClick={() => {
              if (item.filename) {
                openLightbox(item.filename);
              } else {
                selectHistory(item);
                openLightbox();
              }
            }}
            title={buildTooltip(item)}
            aria-label={item.prompt ? `선택: ${item.prompt.slice(0, 40)}` : "이미지 선택"}
            aria-pressed={active}
          >
            <img
              src={item.thumb || item.url || item.image}
              alt=""
              loading="lazy"
              decoding="async"
            />
            {item.favorite ? (
              <span className="history-thumb__fav" aria-label="즐겨찾기">★</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
