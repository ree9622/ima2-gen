import { lazy, Suspense, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { ClassicWorkspace } from "./components/classic/ClassicWorkspace";
import { RightPanel } from "./components/RightPanel";
import { HistoryStrip } from "./components/HistoryStrip";
import { Toast } from "./components/Toast";
import { ErrorCard } from "./components/ErrorCard";
import { GalleryModal } from "./components/GalleryModal";
import { CustomSizeConfirmModal } from "./components/CustomSizeConfirmModal";
import { MetadataRestoreDialog } from "./components/MetadataRestoreDialog";
import { ProviderReadinessPopup } from "./components/ProviderReadinessPopup";
import { OnboardingPopup } from "./components/OnboardingPopup";
import { TrashUndoToast } from "./components/TrashUndoToast";
import { MobileSettingsToggle } from "./components/MobileSettingsToggle";
import { MobileAppBar } from "./components/MobileAppBar";
import { MobileComposeSheet } from "./components/MobileComposeSheet";
import { useAppStore, flushGraphSaveBeacon } from "./store/useAppStore";
import { ENABLE_AGENT_MODE, ENABLE_CARD_NEWS_MODE, ENABLE_NODE_MODE } from "./lib/devMode";
import { useGalleryViewerNavigation } from "./hooks/useGalleryViewerNavigation";
import { useBrowserAttentionBadge } from "./hooks/useBrowserAttentionBadge";
import { useIsMobile } from "./hooks/useIsMobile";
import { useVisualViewportInset } from "./hooks/useVisualViewportInset";
import { resolveWorkspaceSettings } from "./lib/workspaceProfile";

const LazyNodeCanvas = lazy(() =>
  import("./components/NodeCanvas").then((module) => ({ default: module.NodeCanvas })),
);
const LazySettingsWorkspace = lazy(() =>
  import("./components/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })),
);
const LazyCardNewsWorkspace = lazy(() =>
  import("./components/card-news/CardNewsWorkspace").then((module) => ({ default: module.CardNewsWorkspace })),
);
const LazyAgentWorkspace = lazy(() =>
  import("./components/agent/AgentWorkspace").then((module) => ({ default: module.AgentWorkspace })),
);
const LazyPromptLibraryPanel = lazy(() =>
  import("./components/PromptLibraryPanel").then((module) => ({ default: module.PromptLibraryPanel })),
);

function WorkspaceFallback() {
  return <main className="canvas canvas--lazy-loading" aria-busy="true" />;
}

export default function App() {
  useGalleryViewerNavigation();
  useVisualViewportInset();
  const hydrateHistory = useAppStore((s) => s.hydrateHistory);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const startInFlightPolling = useAppStore((s) => s.startInFlightPolling);
  const reconcileInflight = useAppStore((s) => s.reconcileInflight);
  const syncFromStorage = useAppStore((s) => s.syncFromStorage);
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const themeFamily = useAppStore((s) => s.themeFamily);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const unseenGeneratedCount = useAppStore((s) => s.unseenGeneratedCount);
  const historyStripLayout = useAppStore((s) => s.historyStripLayout);
  const workspaceProfile = useAppStore((s) => s.workspaceProfile);
  const syncThemeFromStorage = useAppStore((s) => s.syncThemeFromStorage);
  const syncThemeFamilyFromStorage = useAppStore((s) => s.syncThemeFamilyFromStorage);
  const refreshResolvedTheme = useAppStore((s) => s.refreshResolvedTheme);
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const uiMode =
    uiModeRaw === "agent" && ENABLE_AGENT_MODE ? "agent" :
      uiModeRaw === "card-news" && ENABLE_CARD_NEWS_MODE ? "card-news" :
      uiModeRaw === "node" && ENABLE_NODE_MODE ? "node" :
        "classic";
  const isAgentMode = uiMode === "agent";
  const isMobile = useIsMobile();
  const workspaceSettings = resolveWorkspaceSettings(workspaceProfile);
  const promptStudioClassic =
    !isMobile &&
    uiMode === "classic" &&
    workspaceSettings.composerPlacement === "bottom" &&
    workspaceSettings.multimodeHistoryGrouping === "sequence";
  const showHistoryStrip = !promptStudioClassic && !isAgentMode;

  useBrowserAttentionBadge(unseenGeneratedCount);

  useEffect(() => {
    hydrateHistory();
    if (ENABLE_AGENT_MODE || ENABLE_NODE_MODE) loadSessions();
    reconcileInflight();
    startInFlightPolling();
  }, [hydrateHistory, loadSessions, reconcileInflight, startInFlightPolling]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === "ima2.inFlight" || e.key === "ima2.selectedFilename") {
        syncFromStorage();
      } else if (e.key === "ima2:theme") {
        syncThemeFromStorage();
      } else if (e.key === "ima2:themeFamily") {
        syncThemeFamilyFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage, syncThemeFromStorage, syncThemeFamilyFromStorage]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themeMode = resolvedTheme;
    root.dataset.themeFamily = themeFamily;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, themeFamily]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", refreshResolvedTheme);
    return () => media.removeEventListener("change", refreshResolvedTheme);
  }, [refreshResolvedTheme, theme]);

  useEffect(() => {
    const onHide = () => {
      flushGraphSaveBeacon(useAppStore.getState);
    };
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  return (
    <>
      <div
        className={`app${workspaceProfile === "prompt-studio" ? " app--prompt-studio" : ""}${settingsOpen ? " app--settings-open" : ""}${
          showHistoryStrip && historyStripLayout === "horizontal" ? " app--history-horizontal" : ""
        }${
          showHistoryStrip && historyStripLayout === "sidebar" ? " app--history-sidebar" : ""
        }`}
        data-theme-mode={resolvedTheme}
        data-theme-family={themeFamily}
        data-history-strip-layout={historyStripLayout}
        data-mobile={isMobile ? "1" : undefined}
        data-ui-mode={uiMode}
      >
        <Sidebar />
        <MobileAppBar />
        {showHistoryStrip ? <HistoryStrip /> : null}
        <Suspense fallback={<WorkspaceFallback />}>
          {settingsOpen ? (
            <LazySettingsWorkspace />
          ) : uiMode === "classic" ? (
            promptStudioClassic ? <ClassicWorkspace /> : <Canvas />
          ) : uiMode === "node" ? (
            <LazyNodeCanvas />
          ) : uiMode === "card-news" ? (
            <LazyCardNewsWorkspace />
          ) : uiMode === "agent" ? (
            <LazyAgentWorkspace />
          ) : (
            <Canvas />
          )}
        </Suspense>
        {uiMode === "agent" ? null : uiMode === "card-news" ? null : <RightPanel />}
      </div>
      <CustomSizeConfirmModal />
      <TrashUndoToast />
      <Toast />
      <ErrorCard />
      <GalleryModal />
      <MetadataRestoreDialog />
      <ProviderReadinessPopup />
      <OnboardingPopup />
      <MobileComposeSheet />
      <MobileSettingsToggle />
      {uiMode === "card-news" ? (
        <Suspense fallback={null}>
          <LazyPromptLibraryPanel />
        </Suspense>
      ) : null}
    </>
  );
}
