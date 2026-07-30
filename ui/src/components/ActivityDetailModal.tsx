import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { getFailedLogByRequestId } from "../lib/api";
import { PromptRuntimeBlock } from "./PromptRuntimeBlock";
import type { GenerationLogItem } from "../types";

function formatTs(ts: number | undefined): string {
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

function endpointLabel(ep: GenerationLogItem["endpoint"] | undefined): string {
  if (ep === "edit") return "편집";
  if (ep === "node") return "노드";
  return "생성";
}

const RED = "var(--red, #e04c4c)";
const MUTED = "var(--muted, #888)";

// 최근 생성 목록에서 실패 항목을 눌렀을 때 뜨는 상세 팝업.
// 어떤 프롬프트로, 어떤 사진을 첨부해서, 왜 실패했는지를 한 화면에서 보여주고
// 그대로 재시도할 수 있게 한다. 상세는 서버 실패 sidecar가 원본이다.
export function ActivityDetailModal() {
  const id = useAppStore((s) => s.activityDetailId);
  const close = useAppStore((s) => s.closeActivityDetail);
  const activity = useAppStore((s) => s.inFlight.find((f) => f.id === s.activityDetailId));
  const retryFromLog = useAppStore((s) => s.retryFromLog);
  const retryActivity = useAppStore((s) => s.retryActivity);

  const [record, setRecord] = useState<GenerationLogItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setRecord(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRecord(null);
    setLoadError(null);
    void (async () => {
      try {
        const found = await getFailedLogByRequestId(id);
        if (cancelled) return;
        setRecord(found);
        if (!found) setLoadError("서버에 남은 상세 기록을 찾지 못했습니다.");
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "상세 기록을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, close]);

  if (!id) return null;

  const prompt = record?.prompt ?? activity?.prompt ?? null;
  const errorCode = record?.errorCode ?? null;
  const errorMessage = record?.errorMessage ?? activity?.errorMessage ?? null;
  const references = record?.references ?? [];
  const referenceCount = record?.referenceCount ?? 0;
  const attempts = record?.attempts ?? [];
  const settingsText = [
    endpointLabel(record?.endpoint),
    record?.quality ? `품질 ${record.quality}` : null,
    record?.size ? `사이즈 ${record.size}` : null,
    record?.format ?? null,
    record?.moderation ? `moderation ${record.moderation}` : null,
    attempts.length > 0 ? `${attempts.length}회 시도` : null,
  ].filter(Boolean).join(" · ");

  const handleRetry = async () => {
    if (record?.prompt) {
      close();
      await retryFromLog(record);
      return;
    }
    // 서버 상세가 없으면 활동 로그에 남은 프롬프트로라도 재시도한다.
    close();
    await retryActivity(id);
  };

  return (
    <div
      className="gallery-modal"
      role="dialog"
      aria-modal="true"
      aria-label="실패 상세"
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
          width: "min(760px, 100%)",
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>실패 상세</strong>
            <span
              style={{
                color: RED,
                fontWeight: 600,
                fontSize: 12,
                padding: "2px 8px",
                border: `1px solid ${RED}`,
                borderRadius: 4,
              }}
            >
              실패
            </span>
            <span style={{ fontSize: 12, color: MUTED }}>
              {formatTs(record?.createdAt ?? activity?.endedAt ?? activity?.startedAt)}
              {settingsText ? ` · ${settingsText}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="option-btn active"
              style={{ padding: "4px 10px", fontSize: 13 }}
              disabled={loading || !prompt}
              onClick={() => void handleRetry()}
            >
              재시도
            </button>
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
          </div>
        </header>

        <div style={{ overflowY: "auto", padding: 16, display: "grid", gap: 16 }}>
          <section>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>실패 사유</div>
            {errorMessage ? (
              <div
                style={{
                  fontSize: 13,
                  color: RED,
                  border: `1px solid ${RED}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {errorCode ? `[${errorCode}] ` : ""}
                {errorMessage}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: MUTED }}>
                {loading ? "불러오는 중..." : "기록된 실패 사유가 없습니다."}
              </div>
            )}
            {loadError ? (
              <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>{loadError}</div>
            ) : null}
          </section>

          <section>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>프롬프트</div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                font: "inherit",
                fontSize: 13,
                background: "var(--surface, #111)",
                border: "1px solid var(--line, #2a2a2a)",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              {prompt ?? "프롬프트 없음"}
            </pre>
            {record?.originalPrompt && record.originalPrompt !== record.prompt ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>원본 프롬프트</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    font: "inherit",
                    fontSize: 12,
                    color: MUTED,
                  }}
                >
                  {record.originalPrompt}
                </pre>
              </div>
            ) : null}
          </section>

          <section>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
              첨부 이미지 {referenceCount > 0 ? `${referenceCount}장` : "없음"}
            </div>
            {references.length > 0 ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {references.map((ref, i) => (
                    <a
                      key={`${ref.hash}_${i}`}
                      href={ref.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="새 탭에서 원본 크게 보기"
                      style={{ display: "block", lineHeight: 0 }}
                    >
                      <img
                        src={ref.sourceUrl}
                        alt={`첨부 이미지 ${i + 1}`}
                        style={{
                          width: 96,
                          height: 96,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: "1px solid var(--line, #2a2a2a)",
                          cursor: "zoom-in",
                        }}
                      />
                    </a>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: MUTED }}>
                  썸네일을 누르면 새 탭에서 원본을 크게 볼 수 있습니다.
                </div>
              </>
            ) : referenceCount > 0 ? (
              <div style={{ fontSize: 12, color: RED }}>
                첨부 이미지 {referenceCount}장의 원본 기록을 찾지 못했습니다. 이 상태로는 같은
                첨부로 재시도할 수 없습니다.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: MUTED }}>
                {loading ? "불러오는 중..." : "첨부 없이 생성한 요청입니다."}
              </div>
            )}
          </section>

          {attempts.length > 0 ? (
            <section>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>시도별 결과</div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 12,
                  color: "var(--muted, #aaa)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {attempts.map((a) => (
                  <li key={a.attempt}>
                    <span style={{ color: a.ok ? "var(--green, #3ba55d)" : RED }}>
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
                    <PromptRuntimeBlock runtime={a.promptRuntime ?? record?.promptRuntime ?? null} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
