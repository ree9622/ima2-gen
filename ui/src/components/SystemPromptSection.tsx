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
          {!enabled && (
            <span
              className="sys-prompt__badge sys-prompt__badge--off"
              title="꺼진 동안에는 수위·의도 해석 지시가 빠져 거절로 인한 실패가 늘어납니다."
            >
              비활성
            </span>
          )}
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
            모든 이미지 생성/편집 직전에 모델에 전달되는 기본 지시문입니다. 브리프를 얼마나 그대로
            그릴지, 의도를 무엇으로 판단할지를 정합니다. 끄더라도 "이미지 도구로만 답한다"는 출력
            계약과 카테고리 시트 읽는 규칙은 Developer 프롬프트에 남습니다.
          </p>
          {!enabled && (
            <p className="sys-prompt__hint sys-prompt__hint--warn">
              지금은 꺼져 있습니다. 최근 14일 실측에서 켠 상태의 실패율은 25%, 끈 상태는 63%였습니다
              (대부분 모델이 이미지 대신 거절 문장을 돌려준 경우). 실패가 잦으면 먼저 이 토글을
              확인해 주세요.
            </p>
          )}
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
