import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { deleteFailedLogItem, getGenerationLog } from "../lib/api";
import type { GenerationLogItem } from "../types";

function formatTs(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function endpointLabel(ep: GenerationLogItem["endpoint"]): string {
  if (ep === "edit") return "편집";
  if (ep === "node") return "노드";
  return "생성";
}

export function GenerationLogModal() {
  const open = useAppStore((s) => s.logModalOpen);
  const close = useAppStore((s) => s.closeLogModal);
  const retryFromLog = useAppStore((s) => s.retryFromLog);
  const showToast = useAppStore((s) => s.showToast);

  const [items, setItems] = useState<GenerationLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getGenerationLog({
        limit: 200,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setItems(res.items);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "로그를 불러오지 못했습니다.", true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const handleDelete = async (item: GenerationLogItem) => {
    if (item.status !== "failed") return;
    try {
      await deleteFailedLogItem(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "삭제 실패", true);
    }
  };

  return (
    <div
      className="gallery-modal"
      role="dialog"
      aria-modal="true"
      aria-label="생성 로그"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(900px, 100%)",
          maxHeight: "90vh",
          background: "var(--bg, #0b0b0b)",
          color: "inherit",
          border: "1px solid var(--line, #2a2a2a)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--line, #2a2a2a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <strong>생성 로그</strong>
            <div className="option-row" style={{ gap: 4 }}>
              {(["all", "success", "failed"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`option-btn${statusFilter === v ? " active" : ""}`}
                  onClick={() => setStatusFilter(v)}
                  style={{ padding: "4px 10px", fontSize: 13 }}
                >
                  {v === "all" ? "전체" : v === "success" ? "성공" : "실패"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="option-btn"
              style={{ padding: "4px 10px", fontSize: 13 }}
              disabled={loading}
            >
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              fontSize: 20,
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ×
          </button>
        </header>
        <div style={{ overflowY: "auto", padding: 12 }}>
          {items.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted, #888)" }}>
              {loading ? "불러오는 중..." : "로그가 비어있습니다."}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item) => {
                const isOpen = expanded[item.id] === true;
                const badgeColor =
                  item.status === "success" ? "var(--green, #3ba55d)" : "var(--red, #e04c4c)";
                return (
                  <li
                    key={item.id}
                    style={{
                      border: "1px solid var(--line, #2a2a2a)",
                      borderRadius: 8,
                      padding: 12,
                      background: "var(--surface, #111)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span
                        style={{
                          color: badgeColor,
                          fontWeight: 600,
                          fontSize: 12,
                          padding: "2px 8px",
                          border: `1px solid ${badgeColor}`,
                          borderRadius: 4,
                        }}
                      >
                        {item.status === "success" ? "성공" : "실패"}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted, #888)" }}>
                        {formatTs(item.createdAt)} · {endpointLabel(item.endpoint)} ·{" "}
                        {item.attempts.length}회 시도
                        {item.quality ? ` · ${item.quality}` : ""}
                        {item.size ? ` · ${item.size}` : ""}
                      </span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="option-btn"
                          style={{ padding: "4px 10px", fontSize: 13 }}
                          onClick={() => setExpanded((p) => ({ ...p, [item.id]: !isOpen }))}
                        >
                          {isOpen ? "접기" : "펼치기"}
                        </button>
                        <button
                          type="button"
                          className="option-btn active"
                          style={{ padding: "4px 10px", fontSize: 13 }}
                          disabled={!item.prompt}
                          onClick={() => void retryFromLog(item)}
                        >
                          재시도
                        </button>
                        {item.status === "failed" ? (
                          <button
                            type="button"
                            className="option-btn"
                            style={{ padding: "4px 10px", fontSize: 13, color: "var(--red, #e04c4c)" }}
                            onClick={() => void handleDelete(item)}
                          >
                            삭제
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 13,
                        whiteSpace: "pre-wrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: isOpen ? undefined : 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {item.prompt ?? <em style={{ color: "var(--muted, #888)" }}>프롬프트 없음</em>}
                    </div>
                    {item.errorMessage ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--red, #e04c4c)" }}>
                        {item.errorCode ? `[${item.errorCode}] ` : ""}
                        {item.errorMessage}
                      </div>
                    ) : null}
                    {isOpen && item.attempts.length > 0 ? (
                      <ol
                        style={{
                          marginTop: 10,
                          paddingLeft: 20,
                          fontSize: 12,
                          color: "var(--muted, #aaa)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {item.attempts.map((a) => (
                          <li key={a.attempt}>
                            <span style={{ color: a.ok ? "var(--green, #3ba55d)" : "var(--red, #e04c4c)" }}>
                              {a.ok ? "✓" : "✗"}
                            </span>{" "}
                            #{a.attempt} · {a.durationMs}ms
                            {a.compliantVariant ? " · 프롬프트 재작성" : ""}
                            {a.errorMessage ? (
                              <div style={{ paddingLeft: 14 }}>
                                {a.errorCode ? `[${a.errorCode}] ` : ""}
                                {a.errorMessage}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
