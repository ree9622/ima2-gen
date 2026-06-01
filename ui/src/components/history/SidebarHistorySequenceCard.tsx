import { getGalleryItemKey } from "../../lib/galleryNavigation";
import { isVideoItem } from "../../lib/videoMedia";
import {
  getSequenceThumbSlotCount,
  type SidebarHistoryEntry,
} from "../../lib/history/sidebarHistory";

type SidebarHistorySequenceEntry = Extract<SidebarHistoryEntry, { type: "sequence" }>;

type SidebarHistorySequenceCardProps = {
  entry: SidebarHistorySequenceEntry;
  active: boolean;
  selectLabel: string;
  deleteLabel: string;
  setRef: (key: string, node: HTMLButtonElement | null) => void;
  onSelect: (sequenceId: string) => void;
  onDelete: (sequenceId: string) => void;
};

export function SidebarHistorySequenceCard({
  entry,
  active,
  selectLabel,
  deleteLabel,
  setRef,
  onSelect,
  onDelete,
}: SidebarHistorySequenceCardProps) {
  const slotCount = getSequenceThumbSlotCount(entry.items.length);

  return (
    <div className="sidebar-history__item">
      <button
        ref={(node) => setRef(entry.key, node)}
        type="button"
        className={`sidebar-history__sequence${active ? " active" : ""}`}
        onClick={() => onSelect(entry.sequenceId)}
        aria-label={selectLabel}
      >
        <span
          className={`sidebar-history__sequence-grid count-${slotCount}`}
          aria-hidden="true"
        >
          {Array.from({ length: slotCount }).map((_, index) => {
            const item = entry.items[index];
            return item ? (
              isVideoItem(item) ? (
                <video
                  key={getGalleryItemKey(item)}
                  src={item.url || item.image}
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  key={getGalleryItemKey(item)}
                  src={item.thumb || item.url || item.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )
            ) : (
              <span
                key={`sequence-placeholder-${entry.sequenceId}-${index}`}
                className="sidebar-history__sequence-placeholder"
              />
            );
          })}
        </span>
        <span className="sidebar-history__sequence-badge">
          {entry.items.length}
        </span>
      </button>
      <button
        type="button"
        className="sidebar-history__delete"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete(entry.sequenceId);
        }}
        aria-label={deleteLabel}
        title={deleteLabel}
      >
        x
      </button>
    </div>
  );
}
