import { useAppStore } from "../store/useAppStore";

export function HistoryStrip() {
  const history = useAppStore((s) => s.history);
  const currentImage = useAppStore((s) => s.currentImage);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const openGallery = useAppStore((s) => s.openGallery);

  return (
    <div className="history-strip">
      {history.map((item, i) => {
        const active = currentImage?.image === item.image;
        return (
          <img
            key={`${i}-${item.filename ?? i}`}
            src={item.thumb || item.image}
            alt=""
            className={`history-thumb${active ? " active" : ""}`}
            onClick={() => selectHistory(item)}
          />
        );
      })}
      <button
        type="button"
        className="history-thumb history-thumb--add"
        onClick={openGallery}
        aria-label="Open gallery"
        title="Open gallery"
      >
        +
      </button>
    </div>
  );
}
