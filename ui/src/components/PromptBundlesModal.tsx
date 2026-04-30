import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";

type Props = {
  open: boolean;
  onClose: () => void;
};

// Saved-prompt manager. Mirrors RefBundlesModal so the UX feels familiar:
// "save current prompt under a name" up top, list below with apply / rename
// / delete. Storage is server-side via /api/prompt-bundles (see store actions).
export function PromptBundlesModal({ open, onClose }: Props) {
  const promptText = useAppStore((s) => s.prompt);
  const bundles = useAppStore((s) => s.promptBundles);
  const loading = useAppStore((s) => s.promptBundlesLoading);
  const loadPromptBundles = useAppStore((s) => s.loadPromptBundles);
  const savePromptBundle = useAppStore((s) => s.savePromptBundle);
  const applyPromptBundle = useAppStore((s) => s.applyPromptBundle);
  const deletePromptBundle = useAppStore((s) => s.deletePromptBundle);
  const updatePromptBundle = useAppStore((s) => s.updatePromptBundle);

  const [name, setName] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Hooks must run unconditionally before the early return — placing the
  // useEffect above the `if (!open) return null` keeps the hook order stable
  // across opens/closes (React error #310 trap).
  useEffect(() => {
    if (open) void loadPromptBundles();
  }, [open, loadPromptBundles]);

  // Filtered list (case-insensitive name + tag substring match).
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return bundles;
    return bundles.filter((b) => {
      if (b.name.toLowerCase().includes(q)) return true;
      if ((b.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [bundles, filter]);

  if (!open) return null;

  const parseTags = (raw: string): string[] =>
    raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  const onSave = async () => {
    const tags = parseTags(tagInput);
    const saved = await savePromptBundle(name, { tags });
    if (saved) {
      setName("");
      setTagInput("");
    }
  };

  const onApply = (id: string) => {
    applyPromptBundle(id);
    onClose();
  };

  const onDelete = async (id: string, label: string) => {
    if (!window.confirm(`프롬프트 묶음 "${label}"을 삭제할까요?`)) return;
    await deletePromptBundle(id);
  };

  const startRename = (id: string, current: string) => {
    setEditingId(id);
    setEditName(current);
  };
  const commitRename = async (id: string) => {
    await updatePromptBundle(id, { name: editName });
    setEditingId(null);
    setEditName("");
  };

  const promptHasContent = promptText.trim().length > 0;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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
          minWidth: 520,
          maxWidth: 760,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 17 }}>📑 프롬프트 묶음</h3>
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
            현재 입력된 프롬프트({promptText.length}자)를 이름과 태그로 저장합니다.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름 (예: 비키니 피팅룸 셀카, 카페 미시룩)"
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
              disabled={!promptHasContent || !name.trim()}
              style={{
                background: "var(--accent)",
                color: "var(--bg)",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: !promptHasContent || !name.trim() ? "not-allowed" : "pointer",
                opacity: !promptHasContent || !name.trim() ? 0.5 : 1,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              저장
            </button>
          </div>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="태그(쉼표로 구분, 선택) — 예: 셀카, 피팅룸, 미시"
            maxLength={120}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 12,
            }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="저장된 묶음에서 검색 (이름·태그)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 13,
            }}
          />
        </div>

        {loading ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13 }}>불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
            {bundles.length === 0
              ? "저장된 프롬프트가 없습니다. 위에서 첫 묶음을 만들어 보세요."
              : "검색 조건에 맞는 묶음이 없습니다."}
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((b) => (
              <li
                key={b.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  background: "var(--surface-2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  {editingId === b.id ? (
                    <>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={60}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(b.id);
                          else if (e.key === "Escape") setEditingId(null);
                        }}
                        style={{
                          flex: 1,
                          background: "var(--surface)",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 8px",
                          fontSize: 13,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void commitRename(b.id)}
                        style={{
                          background: "var(--accent)",
                          color: "var(--bg)",
                          border: "none",
                          borderRadius: 6,
                          padding: "4px 10px",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        확인
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        style={{
                          background: "transparent",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 10px",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{b.name}</span>
                      <button
                        type="button"
                        onClick={() => onApply(b.id)}
                        style={{
                          background: "var(--accent)",
                          color: "var(--bg)",
                          border: "none",
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        적용
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(b.id, b.name)}
                        title="이름 변경"
                        style={{
                          background: "transparent",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 8px",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(b.id, b.name)}
                        title="삭제"
                        style={{
                          background: "transparent",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 8px",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
                {(b.tags ?? []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                    {(b.tags ?? []).map((t) => (
                      <span
                        key={t}
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "1px 8px",
                          fontSize: 11,
                          color: "var(--text-dim)",
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-dim)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 88,
                    overflowY: "auto",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  {b.prompt}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
