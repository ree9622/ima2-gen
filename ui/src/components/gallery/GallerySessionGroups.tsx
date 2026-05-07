import type { ReactNode } from "react";
import type { GenerateItem } from "../../types";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export type GallerySessionGroup = {
  sessionId: string;
  title: string | null;
  displayLabel: string;
  items: GenerateItem[];
};

type GallerySessionGroupsProps = {
  groups: GallerySessionGroup[];
  loose: GenerateItem[];
  favoritesOnly: boolean;
  galleryScope: "current-session" | "all";
  setGalleryScope: (scope: "current-session" | "all") => void;
  renderTile: (item: GenerateItem, keyPrefix: string, idx: number) => ReactNode;
  t: TranslateFn;
};

export function GallerySessionGroups({
  groups,
  loose,
  favoritesOnly,
  galleryScope,
  setGalleryScope,
  renderTile,
  t,
}: GallerySessionGroupsProps) {
  if (groups.length === 0 && loose.length === 0) {
    return (
      <div className="gallery__empty">
        {favoritesOnly ? (
          t("gallery.emptyFavorites")
        ) : galleryScope === "current-session" ? (
          <>
            <p>{t("gallery.empty.currentSession")}</p>
            <button type="button" onClick={() => setGalleryScope("all")}>
              {t("gallery.scope.all")}
            </button>
          </>
        ) : (
          t("gallery.emptySessions")
        )}
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.sessionId} className="gallery__group">
          <header className="gallery__group-header">
            <span className="gallery__group-label" title={group.sessionId}>
              {group.title
                ? group.displayLabel
                : t("gallery.sessionLabel", { name: group.displayLabel })}
            </span>
            <span className="gallery__group-count">{group.items.length}</span>
          </header>
          <div className="gallery__grid">
            {group.items.map((item, i) => renderTile(item, group.sessionId, i))}
          </div>
        </section>
      ))}
      {loose.length > 0 && (
        <section className="gallery__group">
          <header className="gallery__group-header">
            <span className="gallery__group-label">{t("gallery.standalone")}</span>
            <span className="gallery__group-count">{loose.length}</span>
          </header>
          <div className="gallery__grid">
            {loose.map((item, i) => renderTile(item, "loose", i))}
          </div>
        </section>
      )}
    </>
  );
}
