import type { PromptRuntime } from "../types";

export function imageModelLabel(runtime?: PromptRuntime | null, fallback?: string | null): string {
  const applied = runtime?.effectiveImage;
  if (applied?.modelSource === "unreported") {
    return "코덱스 자동 선택 (실제 버전 미제공)";
  }
  return (applied?.model || fallback || runtime?.imageModel || "").trim();
}
