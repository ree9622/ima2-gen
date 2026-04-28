import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

type Props = {
  open: boolean;
  onClose: () => void;
};

// Reference-image bundle manager. Save the current reference set under a name,
// reapply it later with one click. Storage is server-side; the binary blobs
// already live under /generated/.refs/<hash>.<ext> via resolveRefLineage so
// bundles only carry small {hash, sourceUrl} records.
export function RefBundlesModal({ open, onClose }: Props) {
  const refsCount = useAppStore((s) => s.referenceImages.length);
  const bundles = useAppStore((s) => s.refBundles);
  const loading = useAppStore((s) => s.refBundlesLoading);
  const loadRefBundles = useAppStore((s) => s.loadRefBundles);
  const saveRefBundle = useAppStore((s) => s.saveRefBundle);
  const applyRefBundle = useAppStore((s) => s.applyRefBundle);
  const deleteRefBundle = useAppStore((s) => s.deleteRefBundle);
  const renameRefBundle = useAppStore((s) => s.renameRefBundle);

  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // useEffect MUST stay before any conditional return so hook order is stable
  // across opens/closes (React error #310 trap).
  useEffect(() => {
    if (open) void loadRefBundles();
  }, [open, loadRefBundles]);

  if (!open) return null;

  const onSave = async () => {
    const saved = await saveRefBundle(name);
    if (saved) setName("");
  };

  const onApply = async (id: string, append: boolean) => {
    await applyRefBundle(id, { append });
    onClose();
  };

  const onDelete = async (id: string, label: string) => {
    if (!window.confirm(`묶음 "${label}"을 삭제할까요?`)) return;
    await deleteRefBundle(id);
  };

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setRenameValue(current);
  };
  const commitRename = async (id: string) => {
    await renameRefBundle(id, renameValue);
    setRenamingId(null);
    setRenameValue("");
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
          minWidth: 480,
          maxWidth: 720,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📦 참조 이미지 묶음</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>
            현재 첨부된 참조 {refsCount}장을 묶음으로 저장합니다.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="묶음 이름 (예: 민지, 나래)"
              maxLength={60}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSave();
                }
              }}
              style={{
                flex: 1,
                background: "var(--surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 13,
              }}
            />
            <button
              type="button"
              onClick={onSave}
              disabled={refsCount === 0 || !name.trim()}
              style={{
                background: "var(--accent)",
                color: "var(--bg)",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontWeight: 600,
                fontSize: 13,
                cursor: refsCount === 0 || !name.trim() ? "not-allowed" : "pointer",
                opacity: refsCount === 0 || !name.trim() ? 0.5 : 1,
              }}
            >
              저장
            </button>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>
          저장된 묶음 ({bundles.length}개)
          {loading && " — 불러오는 중..."}
        </div>

        {bundles.length === 0 && !loading && (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--text-dim)",
              fontSize: 13,
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
          >
            아직 저장된 묶음이 없어요. 자주 쓰는 인물의 참조 이미지를 묶어 저장해 두면 다음에 한 번에 불러올 수 있어요.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {bundles.map((b) => (
            <div
              key={b.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                background: "var(--surface-2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                {renamingId === b.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(b.id);
                      else if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => commitRename(b.id)}
                    style={{
                      flex: 1,
                      background: "var(--surface)",
                      color: "var(--text)",
                      border: "1px solid var(--accent)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      fontSize: 14,
                      fontWeight: 600,
                      marginRight: 8,
                    }}
                  />
                ) : (
                  <div
                    style={{ fontWeight: 600, fontSize: 14, cursor: "text" }}
                    onDoubleClick={() => startRename(b.id, b.name)}
                    title="더블클릭으로 이름 변경"
                  >
                    {b.name}
                    <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: "var(--text-dim)" }}>
                      {b.items.length}장
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => onApply(b.id, false)}
                    title="현재 참조를 이 묶음으로 교체"
                    style={{
                      background: "var(--accent)",
                      color: "var(--bg)",
                      border: "none",
                      borderRadius: 4,
                      padding: "4px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    적용
                  </button>
                  <button
                    type="button"
                    onClick={() => onApply(b.id, true)}
                    title="기존 참조에 이 묶음을 추가"
                    style={{
                      background: "transparent",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "4px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(b.id, b.name)}
                    title="이름 변경"
                    style={{
                      background: "transparent",
                      color: "var(--text-dim)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(b.id, b.name)}
                    title="삭제"
                    style={{
                      background: "transparent",
                      color: "var(--amber)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {b.items.map((item, i) => (
                  <img
                    key={i}
                    src={item.sourceUrl}
                    alt={`${b.name} ${i + 1}`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0.3";
                    }}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
