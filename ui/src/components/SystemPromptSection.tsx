import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { DEFAULT_SYSTEM_PROMPT, SYSTEM_PROMPT_MAX_LEN } from "../lib/defaultSystemPrompt";

export function SystemPromptSection() {
  const systemPrompt = useAppStore((s) => s.systemPrompt);
  const enabled = useAppStore((s) => s.systemPromptEnabled);
  const setText = useAppStore((s) => s.setSystemPrompt);
  const setEnabled = useAppStore((s) => s.setSystemPromptEnabled);
  const reset = useAppStore((s) => s.resetSystemPrompt);
  const [open, setOpen] = useState(false);

  const isModified = systemPrompt !== DEFAULT_SYSTEM_PROMPT;

  return (
    <section className={`sys-prompt ${enabled ? "" : "sys-prompt--off"}`}>
      <header className="sys-prompt__head">
        <button
          type="button"
          className="sys-prompt__toggle-collapse"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? "접기" : "펼치기"}
        >
          <span className={`sys-prompt__chev ${open ? "is-open" : ""}`}>▸</span>
          <span className="sys-prompt__title">기본 프롬프트(시스템)</span>
          {!enabled && <span className="sys-prompt__badge sys-prompt__badge--off">비활성</span>}
          {enabled && isModified && (
            <span className="sys-prompt__badge sys-prompt__badge--mod">수정됨</span>
          )}
        </button>
        <label className="sys-prompt__switch" title="이미지 생성 시 시스템 프롬프트 포함 여부">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>{enabled ? "ON" : "OFF"}</span>
        </label>
      </header>
      {open && (
        <div className="sys-prompt__body">
          <p className="sys-prompt__hint">
            모든 이미지 생성/편집 직전에 모델에 전달되는 기본 지시문입니다. 끄면 사용자 프롬프트만
            전송됩니다.
          </p>
          <textarea
            className="sys-prompt__textarea"
            value={systemPrompt}
            onChange={(e) => setText(e.target.value)}
            disabled={!enabled}
            spellCheck={false}
            rows={10}
            maxLength={SYSTEM_PROMPT_MAX_LEN}
            placeholder="시스템 프롬프트 텍스트…"
          />
          <div className="sys-prompt__footer">
            <span className="sys-prompt__count">
              {systemPrompt.length} / {SYSTEM_PROMPT_MAX_LEN}
            </span>
            <button
              type="button"
              className="sys-prompt__reset"
              onClick={reset}
              disabled={!isModified && enabled}
              title="기본 텍스트 + ON 상태로 복원"
            >
              기본값 복원
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
