import { useAppStore } from "../store/useAppStore";

export function UIModeSwitch() {
  const uiMode = useAppStore((s) => s.uiMode);
  const setUIMode = useAppStore((s) => s.setUIMode);

  return (
    <div className="ui-mode-switch" role="tablist" aria-label="UI Mode">
      <button
        type="button"
        role="tab"
        aria-selected={uiMode === "classic"}
        className={`ui-mode-switch__tab${uiMode === "classic" ? " active" : ""}`}
        onClick={() => setUIMode("classic")}
      >
        Classic
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={uiMode === "node"}
        className={`ui-mode-switch__tab${uiMode === "node" ? " active" : ""}`}
        onClick={() => setUIMode("node")}
      >
        Node
      </button>
    </div>
  );
}
