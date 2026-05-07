import type { HistoryCursor } from "../../lib/api";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

type GalleryLoadControlsProps = {
  showSessions: boolean;
  favoritesOnly: boolean;
  query: string;
  historyNextCursor: HistoryCursor | null;
  favoriteHistoryNextCursor: HistoryCursor | null;
  historyLoadingOlder: boolean;
  favoriteHistoryLoadingOlder: boolean;
  onLoadOlder: () => void;
  onLoadOlderFavorites: () => void;
  t: TranslateFn;
};

export function GalleryLoadControls({
  showSessions,
  favoritesOnly,
  query,
  historyNextCursor,
  favoriteHistoryNextCursor,
  historyLoadingOlder,
  favoriteHistoryLoadingOlder,
  onLoadOlder,
  onLoadOlderFavorites,
  t,
}: GalleryLoadControlsProps) {
  if (showSessions) {
    return (
      <div className="gallery__load-more gallery__load-more--hint">
        {t("gallery.sessionPaginationHint")}
      </div>
    );
  }
  if (query.trim()) return null;
  if (favoritesOnly) {
    if (!favoriteHistoryNextCursor) return null;
    return (
      <div className="gallery__load-more">
        <button
          type="button"
          onClick={onLoadOlderFavorites}
          disabled={favoriteHistoryLoadingOlder}
        >
          {favoriteHistoryLoadingOlder
            ? t("gallery.loadingOlderFavorites")
            : t("gallery.loadOlderFavorites")}
        </button>
      </div>
    );
  }
  if (!historyNextCursor) return null;
  return (
    <div className="gallery__load-more">
      <button type="button" onClick={onLoadOlder} disabled={historyLoadingOlder}>
        {historyLoadingOlder ? t("gallery.loadingOlder") : t("gallery.loadOlder")}
      </button>
    </div>
  );
}
