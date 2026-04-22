import { useRef, useState, type DragEvent } from "react";
import { useAppStore } from "../store/useAppStore";

const MAX_REFS = 5;

export function ReferenceUploader() {
  const refs = useAppStore((s) => s.referenceImages);
  const addReferences = useAppStore((s) => s.addReferences);
  const removeReference = useAppStore((s) => s.removeReference);
  const useCurrentAsReference = useAppStore((s) => s.useCurrentAsReference);
  const currentImage = useAppStore((s) => s.currentImage);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) void addReferences(files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const slots: (string | null)[] = Array.from({ length: MAX_REFS }, (_, i) => refs[i] ?? null);
  const canAddMore = refs.length < MAX_REFS;

  return (
    <div
      className={`ref-uploader${dragOver ? " ref-uploader--drag" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="section-title">
        References <span className="ref-uploader__count">{refs.length}/{MAX_REFS}</span>
      </div>

      <div className="ref-uploader__grid">
        {slots.map((src, i) =>
          src ? (
            <div key={i} className="ref-slot ref-slot--filled">
              <img src={src} alt={`reference ${i + 1}`} />
              <button
                type="button"
                className="ref-slot__remove"
                onClick={() => removeReference(i)}
                aria-label={`Remove reference ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              key={i}
              type="button"
              className="ref-slot ref-slot--empty"
              onClick={() => canAddMore && fileInput.current?.click()}
              disabled={!canAddMore}
              aria-label="Add reference image"
            >
              +
            </button>
          ),
        )}
      </div>

      <div className="ref-uploader__actions">
        <button
          type="button"
          className="ref-uploader__btn"
          onClick={() => fileInput.current?.click()}
          disabled={!canAddMore}
          title="Pick image files"
        >
          Upload
        </button>
        <button
          type="button"
          className="ref-uploader__btn"
          onClick={useCurrentAsReference}
          disabled={!currentImage || !canAddMore}
          title="Use current result as a reference"
        >
          Use current
        </button>
      </div>

      <div className="ref-uploader__hint">Drop image files anywhere here (max 5).</div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void addReferences(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
