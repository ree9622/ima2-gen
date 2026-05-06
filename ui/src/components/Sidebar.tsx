import { ProviderSelect } from "./ProviderSelect";
import { UIModeSwitch } from "./UIModeSwitch";
import { PromptComposer } from "./PromptComposer";
import { GenerateButton } from "./GenerateButton";
import { InFlightList } from "./InFlightList";
import { HistoryStrip } from "./HistoryStrip";
import { SessionPicker } from "./SessionPicker";
import { OAuthIndicator } from "./OAuthIndicator";
import { UserMenu } from "./UserMenu";
import { useAppStore } from "../store/useAppStore";
import { useOAuthStatus } from "../hooks/useOAuthStatus";
import { ENABLE_NODE_MODE } from "../lib/devMode";

export function Sidebar() {
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const uiMode = ENABLE_NODE_MODE ? uiModeRaw : "classic";
  const openLogModal = useAppStore((s) => s.openLogModal);
  const oauth = useOAuthStatus();
  const oauthOk = oauth?.status === "ready";

  return (
    <aside className="sidebar">
      <div className="sidebar__scroll">
        <header className="sidebar__head">
          <div className="logo">
            <span className="logo-dot" aria-hidden="true" />
            <span className="logo-name">이미지 생성기</span>
          </div>
          <div className="sidebar__head-actions">
            <OAuthIndicator />
            <button
              type="button"
              className="sidebar__head-btn"
              onClick={openLogModal}
              title="생성 로그 (재시도 이력)"
              aria-label="생성 로그"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </button>
            <UserMenu />
          </div>
        </header>
        <UIModeSwitch />
        {uiMode === "classic" ? (
          <>
            {/* OAuth 가 ready 상태(99%)일 때는 헤더 dot 만으로 충분 — 카드 숨김. */}
            {!oauthOk && <ProviderSelect />}
            <PromptComposer />
            <GenerateButton />
            <InFlightList />
          </>
        ) : (
          <>
            <SessionPicker />
            <div className="sidebar__node-hint">
              노드 모드에서는 노드를 눌러 프롬프트를 수정한 뒤 생성하세요. 오른쪽 패널의 설정
              (품질/크기)은 새로 만드는 모든 결과에 적용됩니다.
            </div>
            <InFlightList />
          </>
        )}
      </div>
      <HistoryStrip />
    </aside>
  );
}
