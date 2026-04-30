import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { formatRelative } from "../lib/nodeTrash";

export function TrashModal() {
  const open = useAppStore((s) => s.trashOpen);
  const close = useAppStore((s) => s.setTrashOpen);
  const items = useAppStore((s) => s.trashedItems);
  const restore = useAppStore((s) => s.restoreFromTrash);
  const purge = useAppStore((s) => s.purgeTrashItem);
  const empty = useAppStore((s) => s.emptyTrash);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="trash-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div className="trash-modal" role="dialog" aria-label="휴지통">
        <div className="trash-modal__header">
          <h3>휴지통 ({items.length})</h3>
          <div className="trash-modal__header-actions">
            {items.length > 0 ? (
              <button
                type="button"
                className="trash-modal__empty"
                onClick={() => {
                  if (confirm("휴지통의 모든 항목을 영구 삭제할까요?")) empty();
                }}
              >
                전체 비우기
              </button>
            ) : null}
            <button type="button" className="trash-modal__close" onClick={() => close(false)}>
              ✕
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="trash-modal__empty-state">휴지통이 비어 있습니다.</div>
        ) : (
          <ul className="trash-modal__list">
            {items.map((it) => (
              <li key={it.id} className="trash-modal__item">
                <div className="trash-modal__item-main">
                  <div className="trash-modal__item-label" title={it.label}>
                    {it.label}
                  </div>
                  <div className="trash-modal__item-meta">
                    노드 {it.nodes.length}개 · {formatRelative(it.deletedAt)}
                  </div>
                </div>
                <div className="trash-modal__item-actions">
                  <button type="button" onClick={() => restore(it.id)}>
                    복구
                  </button>
                  <button
                    type="button"
                    className="trash-modal__danger"
                    onClick={() => purge(it.id)}
                  >
                    영구 삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="trash-modal__footer">7일이 지나면 자동으로 영구 삭제됩니다.</div>
      </div>
    </div>
  );
}
