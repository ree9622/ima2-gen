import type { AttemptLog, GenerationLogItem } from "../types";

// 한 번의 호출에 실제로 나간 프롬프트/모델 조합을 그대로 펼쳐 보여준다.
// 생성 로그 모달과 실패 상세 팝업이 같은 블록을 공유한다.
export function PromptRuntimeBlock({ runtime }: { runtime: GenerationLogItem["promptRuntime"] }) {
  if (!runtime) return null;
  const routeText = [
    runtime.route ? `경로: ${runtime.route}` : null,
    runtime.imageModel ? `이미지 모델: ${runtime.imageModel}` : null,
    runtime.model ? `호출 모델: ${runtime.model}` : null,
    runtime.reasoningEffort ? `reasoning: ${runtime.reasoningEffort}` : null,
  ].filter(Boolean).join(" · ");
  const rows = [
    ["호출 경로/모델", routeText],
    ["실제 User 입력", runtime.userPrompt],
    ["Developer 프롬프트", runtime.developerPrompt],
    ["기본 프롬프트", runtime.systemPrompt],
    ["도구", runtime.toolNames?.join(", ")],
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0);
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8, paddingLeft: 14, display: "grid", gap: 6 }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: "inherit", color: "var(--text)" }}>
            {value}
          </pre>
        </div>
      ))}
    </div>
  );
}

// 한 시도가 왜 이미지를 못 만들었는지 설명하는 근거들.
// "빈 응답"으로만 보이던 실패의 실제 원인은 대개 이 셋 중 하나다.
//   • refusalText — 모델이 명시적으로 거절한 문구
//   • outputText — 이미지 도구를 안 부르고 글로 답해버린 내용
//   • eventTypeCounts — 그마저도 없을 때, 스트림이 실제로 무엇을 뱉었는지
export function AttemptDiagnostics({ attempt }: { attempt: AttemptLog }) {
  const events = attempt.eventTypeCounts
    ? Object.entries(attempt.eventTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `${type} ×${n}`)
        .join(" · ")
    : null;
  const rows: Array<[string, string]> = [];
  if (attempt.refusalText) rows.push(["모델 거절 문구", attempt.refusalText]);
  if (attempt.outputText) rows.push(["이미지 대신 돌아온 답변", attempt.outputText]);
  if (attempt.reasoningSummary) rows.push(["reasoning 요약", attempt.reasoningSummary]);
  if (attempt.violationCategories?.length) {
    rows.push(["차단 분류", attempt.violationCategories.join(", ")]);
  }
  if (events) rows.push(["스트림 이벤트", events]);
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 6, paddingLeft: 14, display: "grid", gap: 6 }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              font: "inherit",
              fontSize: 12,
              color: "var(--text)",
            }}
          >
            {value}
          </pre>
        </div>
      ))}
    </div>
  );
}
