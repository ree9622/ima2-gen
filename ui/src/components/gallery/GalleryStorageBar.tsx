import type { StorageStatus } from "../../lib/api";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

type GalleryStorageBarProps = {
  status: StorageStatus | null;
  dismissed: boolean;
  onOpenFolder: () => void;
  onDismiss: () => void;
  t: TranslateFn;
};

export function GalleryStorageBar({
  status,
  dismissed,
  onOpenFolder,
  onDismiss,
  t,
}: GalleryStorageBarProps) {
  const showNotice = status != null && status.state !== "ok" && !dismissed;
  const noticeKey =
    status?.state === "recoverable" ? "gallery.storageNoticeRecoverable"
      : status?.state === "not_found" ? "gallery.storageNoticeNotFound"
        : "gallery.storageNoticeUnknown";

  return (
    <div className={`gallery__storage-bar${showNotice ? " gallery__storage-bar--notice" : ""}`}>
      {showNotice ? (
        <div className="gallery__storage-copy">
          <div className="gallery__storage-title">{t("gallery.storageNoticeTitle")}</div>
          <div className="gallery__storage-text">{t(noticeKey)}</div>
        </div>
      ) : (
        <div className="gallery__storage-copy gallery__storage-copy--quiet">
          {status?.generatedDirLabel ?? "~/.ima2/generated"}
        </div>
      )}
      <div className="gallery__storage-actions">
        <button
          type="button"
          className="gallery__storage-button"
          onClick={onOpenFolder}
          title={t("gallery.openGeneratedDirTitle")}
        >
          {t("gallery.openGeneratedDir")}
        </button>
        {showNotice && (
          <button
            type="button"
            className="gallery__storage-button gallery__storage-button--ghost"
            onClick={onDismiss}
          >
            {t("common.close")}
          </button>
        )}
      </div>
    </div>
  );
}
