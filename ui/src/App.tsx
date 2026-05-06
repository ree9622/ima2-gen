import { lazy, Suspense, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { RightPanel } from "./components/RightPanel";
import { Toast } from "./components/Toast";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { useAppStore, flushGraphSaveBeacon } from "./store/useAppStore";
import { ENABLE_NODE_MODE } from "./lib/devMode";
import { useLightboxUrlSync } from "./lib/urlSync";

// Heavy / open-on-demand components are split out of the entry chunk.
// First paint only loads Sidebar + Canvas + RightPanel + Toast +
// ShortcutsHelp. Node canvas and modals fetch their chunks only when the
// user actually opens them.
const NodeCanvas = lazy(() =>
  import("./components/NodeCanvas").then((m) => ({ default: m.NodeCanvas })),
);
const GalleryModal = lazy(() =>
  import("./components/GalleryModal").then((m) => ({ default: m.GalleryModal })),
);
const Lightbox = lazy(() =>
  import("./components/Lightbox").then((m) => ({ default: m.Lightbox })),
);
const GenerationLogModal = lazy(() =>
  import("./components/GenerationLogModal").then((m) => ({
    default: m.GenerationLogModal,
  })),
);
const PromptLibraryModal = lazy(() =>
  import("./components/PromptLibraryModal").then((m) => ({
    default: m.PromptLibraryModal,
  })),
);
const LoginPage = lazy(() =>
  import("./components/LoginPage").then((m) => ({ default: m.LoginPage })),
);

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

  // Modal open states drive conditional mount so a lazy chunk only fetches
  // the first time the user actually opens that modal.
  const galleryOpen = useAppStore((s) => s.galleryOpen);
  const lightboxOpen = useAppStore((s) => s.lightboxOpen);
  const logModalOpen = useAppStore((s) => s.logModalOpen);
  const promptLibraryOpen = useAppStore((s) => s.promptLibraryOpen);

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

  // Auth required and we don't have one — show the LoginPage.
  if (auth.status === "anonymous" && auth.authEnabled) {
    return (
      <>
        <Suspense fallback={null}>
          <LoginPage />
        </Suspense>
        <Toast />
      </>
    );
  }

  return (
    <>
      <div className="app">
        <Sidebar />
        {uiMode === "classic" ? (
          <Canvas />
        ) : (
          <Suspense
            fallback={
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                노드 캔버스 로딩 중…
              </div>
            }
          >
            <NodeCanvas />
          </Suspense>
        )}
        <RightPanel />
      </div>
      <Toast />
      <ShortcutsHelp />
      {galleryOpen && (
        <Suspense fallback={null}>
          <GalleryModal />
        </Suspense>
      )}
      {logModalOpen && (
        <Suspense fallback={null}>
          <GenerationLogModal />
        </Suspense>
      )}
      {promptLibraryOpen && (
        <Suspense fallback={null}>
          <PromptLibraryModal />
        </Suspense>
      )}
      {lightboxOpen && (
        <Suspense fallback={null}>
          <Lightbox />
        </Suspense>
      )}
    </>
  );
}
