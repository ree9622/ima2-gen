import { lazy, Suspense, useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { GenerationControlsPanel } from "./GenerationControlsPanel";
import { isPromptBuilderEnabled } from "../lib/workspaceProfile";

const LazyPromptLibraryPanel = lazy(() =>
  import("./PromptLibraryPanel").then((module) => ({ default: module.PromptLibraryPanel })),
);

const LazyPromptBuilderPanel = lazy(() =>
  import("./prompt-builder/PromptBuilderPanel").then((module) => ({
    default: module.PromptBuilderPanel,
  })),
);

type RightPanelTab = "settings" | "library" | "builder";

export function RightPanel() {
  const open = useAppStore((s) => s.rightPanelOpen);
  const toggle = useAppStore((s) => s.toggleRightPanel);
  const promptLibraryOpen = useAppStore((s) => s.promptLibraryOpen);
  const setPromptLibraryOpen = useAppStore((s) => s.setPromptLibraryOpen);
  const promptBuilderOpen = useAppStore((s) => s.promptBuilderOpen);
  const togglePromptBuilder = useAppStore((s) => s.togglePromptBuilder);
  const workspaceProfile = useAppStore((s) => s.workspaceProfile);
  const { t } = useI18n();
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 800px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 800px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const builderEnabled = isPromptBuilderEnabled(workspaceProfile) && !isMobile;
  const drawerOpen = isMobile ? open : true;

  const activeTab: RightPanelTab = promptBuilderOpen && builderEnabled
    ? "builder"
    : promptLibraryOpen
      ? "library"
      : "settings";

  const setTab = (tab: RightPanelTab) => {
    if (tab === "builder") {
      if (!promptBuilderOpen) togglePromptBuilder();
      if (promptLibraryOpen) setPromptLibraryOpen(false);
    } else if (tab === "library") {
      if (promptBuilderOpen) togglePromptBuilder();
      if (!promptLibraryOpen) setPromptLibraryOpen(true);
    } else {
      if (promptBuilderOpen) togglePromptBuilder();
      if (promptLibraryOpen) setPromptLibraryOpen(false);
    }
  };

  return (
    <>
      {isMobile && open ? (
        <div
          className="right-panel-backdrop"
          role="button"
          aria-label={t("panel.closeSettings")}
          onClick={toggle}
        />
      ) : null}
      <aside
        className={`right-panel${open ? "" : " collapsed"}${isMobile && drawerOpen ? " drawer-open" : ""}`}
        aria-label={t("panel.detailSettings")}
      >
        {!isMobile && (
          <button
            type="button"
            className="right-panel-toggle"
            aria-expanded={open}
            aria-controls="right-panel-body"
            onClick={toggle}
            title={open ? t("panel.toggleHide") : t("panel.toggleShow")}
          >
            {open ? ">" : "<"}
          </button>
        )}
        <div
          id="right-panel-body"
          className="right-panel-body"
          hidden={!open}
        >
          <div className="right-panel-tabs" role="tablist" aria-label={t("panel.detailSettings")}>
            {builderEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "builder"}
                className={`right-panel-tabs__button${activeTab === "builder" ? " active" : ""}`}
                onClick={() => setTab("builder")}
              >
                {t("promptBuilder.title")}
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "settings"}
              className={`right-panel-tabs__button${activeTab === "settings" ? " active" : ""}`}
              onClick={() => setTab("settings")}
            >
              {t("panel.detailSettings")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "library"}
              className={`right-panel-tabs__button right-panel-tabs__button--full${activeTab === "library" ? " active" : ""}`}
              onClick={() => setTab("library")}
            >
              {t("promptLibrary.title")}
            </button>
          </div>
          {activeTab === "builder" && builderEnabled ? (
            <Suspense fallback={<div className="prompt-library-panel__loading">{t("common.loading")}</div>}>
              <LazyPromptBuilderPanel variant="sidebar" />
            </Suspense>
          ) : activeTab === "library" ? (
            <Suspense fallback={<div className="prompt-library-panel__loading">{t("common.loading")}</div>}>
              <LazyPromptLibraryPanel variant="embedded" />
            </Suspense>
          ) : (
            <GenerationControlsPanel />
          )}
        </div>
      </aside>
    </>
  );
}
