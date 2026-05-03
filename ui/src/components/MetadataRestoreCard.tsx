// PNG에 박힌 ima2:* tEXt 메타데이터를 인라인 카드로 미리보고
// "이대로 채우기" 클릭 시 prompt/size/quality를 한 번에 복원한다 (Phase 6.2).

import { useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { readIma2MetadataFromFile, type Ima2Metadata } from "../lib/pngMetadata";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; meta: Ima2Metadata; filename: string }
  | { kind: "empty"; filename: string }
  | { kind: "error"; message: string };

export function MetadataRestoreCard() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const restore = useAppStore((s) => s.restoreFromImageMetadata);
  const showToast = useAppStore((s) => s.showToast);

  async function onFile(file: File) {
    setState({ kind: "loading" });
    try {
      const meta = await readIma2MetadataFromFile(file);
      const hasAny = Object.keys(meta).length > 0;
      setState(hasAny ? { kind: "ok", meta, filename: file.name } : { kind: "empty", filename: file.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "파일을 읽을 수 없습니다";
      setState({ kind: "error", message });
    }
  }

  function pick() {
    fileInput.current?.click();
  }

  function close() {
    setState({ kind: "idle" });
    if (fileInput.current) fileInput.current.value = "";
  }

  function applyRestore(meta: Ima2Metadata) {
    restore({
      prompt: meta.prompt,
      size: meta.size,
      quality: meta.quality,
      moderation: meta.moderation,
      fork: meta.fork,
    });
    const hasFork = Boolean(meta.fork && Object.keys(meta.fork).length);
    showToast(hasFork ? "이미지 설정 복원 — 옵션/원문/maxAttempts 도 같이 적용" : "이미지 설정을 복원했습니다", false);
    close();
  }

  return (
    <div className="metadata-restore">
      <button
        type="button"
        className="metadata-restore__trigger"
        onClick={pick}
        title="PNG 파일에 새겨진 prompt·size·quality를 폼으로 복원합니다"
      >
        🔍 이미지에서 복원
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/png"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      {state.kind === "loading" && (
        <div className="metadata-restore__card metadata-restore__card--loading">읽는 중…</div>
      )}

      {state.kind === "empty" && (
        <div className="metadata-restore__card metadata-restore__card--empty">
          <div className="metadata-restore__title">메타데이터가 없습니다</div>
          <div className="metadata-restore__hint">
            <code>{state.filename}</code> 에 ima2가 새긴 정보가 없습니다. 이 도구로 생성한 PNG여야 복원이 가능합니다.
          </div>
          <div className="metadata-restore__actions">
            <button type="button" onClick={close}>닫기</button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="metadata-restore__card metadata-restore__card--error">
          <div className="metadata-restore__title">읽기 실패</div>
          <div className="metadata-restore__hint">{state.message}</div>
          <div className="metadata-restore__actions">
            <button type="button" onClick={close}>닫기</button>
          </div>
        </div>
      )}

      {state.kind === "ok" && (
        <div className="metadata-restore__card metadata-restore__card--ok">
          <div className="metadata-restore__title">
            메타데이터 발견 <small>· {state.filename}</small>
          </div>
          <dl className="metadata-restore__fields">
            {state.meta.prompt && (
              <>
                <dt>프롬프트</dt>
                <dd className="metadata-restore__prompt">{state.meta.prompt}</dd>
              </>
            )}
            {state.meta.size && (
              <>
                <dt>사이즈</dt>
                <dd>{state.meta.size}</dd>
              </>
            )}
            {state.meta.quality && (
              <>
                <dt>품질</dt>
                <dd>{state.meta.quality}</dd>
              </>
            )}
            {state.meta.model && (
              <>
                <dt>모델</dt>
                <dd>{state.meta.model}</dd>
              </>
            )}
            {state.meta.createdAt && (
              <>
                <dt>생성</dt>
                <dd>{new Date(state.meta.createdAt).toLocaleString("ko-KR")}</dd>
              </>
            )}
            {state.meta.revisedPrompt && (
              <>
                <dt>revised</dt>
                <dd className="metadata-restore__prompt metadata-restore__prompt--revised">
                  {state.meta.revisedPrompt}
                </dd>
              </>
            )}
            {state.meta.moderation && (
              <>
                <dt>moderation</dt>
                <dd>{state.meta.moderation}</dd>
              </>
            )}
            {state.meta.fork?.originalPrompt && (
              <>
                <dt>원문</dt>
                <dd className="metadata-restore__prompt metadata-restore__prompt--revised">
                  {state.meta.fork.originalPrompt}
                </dd>
              </>
            )}
            {state.meta.fork?.maxAttempts && (
              <>
                <dt>maxAttempts</dt>
                <dd>{state.meta.fork.maxAttempts}</dd>
              </>
            )}
            {state.meta.fork?.outfit ? (
              <>
                <dt>outfit</dt>
                <dd className="metadata-restore__prompt metadata-restore__prompt--revised">
                  {(() => {
                    const o = state.meta.fork.outfit as { id?: string; label?: string; key?: string } | string | null;
                    if (typeof o === "string") return o;
                    if (o && typeof o === "object") {
                      return o.label || o.id || o.key || JSON.stringify(o);
                    }
                    return null;
                  })()}
                </dd>
              </>
            ) : null}
            {state.meta.fork?.batchId && (
              <>
                <dt>batch</dt>
                <dd>{state.meta.fork.batchId}{state.meta.fork.batchIndex ? " #" + state.meta.fork.batchIndex : ""}</dd>
              </>
            )}
          </dl>
          <div className="metadata-restore__actions">
            <button
              type="button"
              className="metadata-restore__apply"
              onClick={() => applyRestore(state.meta)}
            >
              이대로 채우기
            </button>
            <button type="button" onClick={close}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
