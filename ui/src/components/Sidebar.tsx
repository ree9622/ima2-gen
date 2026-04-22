import { BillingBar } from "./BillingBar";
import { ProviderSelect } from "./ProviderSelect";
import { UIModeSwitch } from "./UIModeSwitch";
import { PromptComposer } from "./PromptComposer";
import { GenerateButton } from "./GenerateButton";
import { InFlightList } from "./InFlightList";
import { HistoryStrip } from "./HistoryStrip";
import { SessionPicker } from "./SessionPicker";
import { useAppStore } from "../store/useAppStore";

export function Sidebar() {
  const uiMode = useAppStore((s) => s.uiMode);
  return (
    <aside className="sidebar">
      <div className="sidebar__scroll">
        <div className="logo">
          <div className="logo-dot" />
          Image Gen
          <span className="logo-badge">gpt-image-2</span>
        </div>
        <UIModeSwitch />
        {uiMode === "classic" ? (
          <>
            <ProviderSelect />
            <PromptComposer />
            <GenerateButton />
            <InFlightList />
          </>
        ) : (
          <>
            <SessionPicker />
            <div className="sidebar__node-hint">
              Node mode: click a node to edit its prompt, then Generate. Settings on the right panel
              (quality/size) apply to all new generations.
            </div>
            <InFlightList />
          </>
        )}
      </div>
      <HistoryStrip />
    </aside>
  );
}
