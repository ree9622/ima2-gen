import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { NodeCanvas } from "./components/NodeCanvas";
import { RightPanel } from "./components/RightPanel";
import { Toast } from "./components/Toast";
import { GalleryModal } from "./components/GalleryModal";
import { GenerationLogModal } from "./components/GenerationLogModal";
import { PromptLibraryModal } from "./components/PromptLibraryModal";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { Lightbox } from "./components/Lightbox";
import { LoginPage } from "./components/LoginPage";
import { useAppStore, flushGraphSaveBeacon } from "./store/useAppStore";
import { ENABLE_NODE_MODE } from "./lib/devMode";
import { useLightboxUrlSync } from "./lib/urlSync";

export default function App() {
  const hydrateHistory = useAppStore((s) => s.hydrateHistory);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const startInFlightPolling = useAppStore((s) => s.startInFlightPolling);
  const reconcileInflight = useAppStore((s) => s.reconcileInflight);
  const syncFromStorage = useAppStore((s) => s.syncFromStorage);
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const uiMode = ENABLE_NODE_MODE ? uiModeRaw : "classic";

  // Auth gate. checkAuth always runs; the rest of the boot sequence waits
  // until we know the user is authed (or auth is server-side disabled).
  const auth = useAppStore((s) => s.auth);
  const checkAuth = useAppStore((s) => s.checkAuth);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    // Skip the heavy data hydration while we're still un-authed — those
    // requests would 401 in waves and clutter the toast/log area. Once
    // the user is authed (or the server has auth disabled entirely) we
    // run them once.
    const ready = auth.status === "authed" || (auth.status === "anonymous" && !auth.authEnabled);
    if (!ready) return;
    hydrateHistory();
    loadSessions();
    reconcileInflight();
    startInFlightPolling();
  }, [auth.status, auth.authEnabled, hydrateHistory, loadSessions, reconcileInflight, startInFlightPolling]);

  useLightboxUrlSync();

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === "ima2.inFlight" || e.key === "ima2.selectedFilename") {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  useEffect(() => {
    // visibilitychange fires on every tab focus shift (mobile keyboard, alt-tab,
    // dev tools), so the beacon would race the active queue and burn If-Match
    // versions. beforeunload alone covers the only case where the queue cannot
    // finish on its own — actual page unload.
    const onHide = () => {
      flushGraphSaveBeacon(useAppStore.getState);
    };
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  // Step 4-A: while the node canvas is open, periodically reconcile orphan
  // node-mode generations whose stream response was lost. Catches the case
  // where the user stays on the page through a long generation that
  // disconnects mid-stream — without this, they'd need to refresh manually.
  const reconcileOrphansFromDisk = useAppStore((s) => s.reconcileOrphansFromDisk);
  useEffect(() => {
    if (uiMode !== "node") return;
    if (auth.status !== "authed" && !(auth.status === "anonymous" && !auth.authEnabled)) return;
    const intervalMs = 60_000;
    const timer = setInterval(() => {
      void reconcileOrphansFromDisk();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [uiMode, auth.status, auth.authEnabled, reconcileOrphansFromDisk]);

  // While checkAuth is in flight, render a tiny placeholder instead of
  // flashing the LoginPage and then immediately replacing it.
  if (auth.status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
          fontSize: 13,
          background: "var(--bg)",
        }}
      >
        세션 확인 중…
      </div>
    );
  }

  // Auth required and we don't have one — show the LoginPage. Toast layer
  // stays mounted so login failures can still surface a brief notice if
  // we ever route them through showToast (currently inline in LoginPage).
  if (auth.status === "anonymous" && auth.authEnabled) {
    return (
      <>
        <LoginPage />
        <Toast />
      </>
    );
  }

  return (
    <>
      <div className="app">
        <Sidebar />
        {uiMode === "classic" ? <Canvas /> : <NodeCanvas />}
        <RightPanel />
      </div>
      <Toast />
      <GalleryModal />
      <GenerationLogModal />
      <PromptLibraryModal />
      <ShortcutsHelp />
      <Lightbox />
    </>
  );
}
