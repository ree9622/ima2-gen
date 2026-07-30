import type { GenerationLogItem } from "../types";

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
          <div style={{ fontSize: 11, color: "var(--muted, #888)" }}>{label}</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: "inherit", color: "var(--fg, #ddd)" }}>
            {value}
          </pre>
        </div>
      ))}
    </div>
  );
}
