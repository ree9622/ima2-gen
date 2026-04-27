// URL <-> Lightbox state sync.
//
// Goal: every image opened in the lightbox has a shareable URL of the form
//   /current/path?image=<filename>
// so that:
//   - users can copy/share the URL and reopen the same image
//   - browser back/forward navigates the lightbox
//   - direct page load with ?image=... auto-opens the lightbox
//
// We avoid pulling in a router library; native History API + popstate is
// enough for a single-page modal sync.

import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";

const PARAM = "image";

// Internal flag so popstate-driven state changes do NOT push another history
// entry (otherwise back/forward would oscillate forever).
let syncFromPopState = false;

export function isApplyingPopState() {
  return syncFromPopState;
}

// Reflect the lightbox state into window.location.
//   filename = null → remove the param
//   replace  = true → use replaceState (no new history entry, e.g. for next/prev)
//            false  → use pushState (e.g. opening the lightbox)
export function syncImageToUrl(filename: string | null, replace = false) {
  if (typeof window === "undefined") return;
  if (syncFromPopState) return;
  const url = new URL(window.location.href);
  const current = url.searchParams.get(PARAM);
  if (filename) {
    if (current === filename) return; // already in sync
    url.searchParams.set(PARAM, filename);
  } else {
    if (!current) return;
    url.searchParams.delete(PARAM);
  }
  const newUrl = url.pathname + (url.search ? url.search : "") + url.hash;
  if (replace) {
    window.history.replaceState({ image: filename }, "", newUrl);
  } else {
    window.history.pushState({ image: filename }, "", newUrl);
  }
}

// Read ?image=<filename> from the current URL, if present.
export function readImageFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(PARAM);
}

// App-level effect: wires popstate + initial-load auto-open.
// Must be called once near the root, after hydrateHistory has been kicked off.
export function useLightboxUrlSync() {
  useEffect(() => {
    // Initial load: if ?image=... is in the URL, wait for history to hydrate
    // and then open the lightbox on that filename. We poll history briefly
    // because hydrateHistory is async and may not be ready when App mounts.
    const initial = readImageFromUrl();
    let cancelled = false;
    if (initial) {
      const tryOpen = (attemptsLeft: number) => {
        if (cancelled) return;
        const hist = useAppStore.getState().history;
        const target = hist.find((h) => h.filename === initial);
        if (target) {
          // Use the store action; it will call syncImageToUrl, but the
          // `current === filename` short-circuit prevents a double push.
          useAppStore.getState().openLightbox(initial);
          return;
        }
        if (attemptsLeft > 0) {
          setTimeout(() => tryOpen(attemptsLeft - 1), 200);
        } else {
          // History fully loaded but the filename isn't there — clean URL.
          syncImageToUrl(null, true);
        }
      };
      tryOpen(25); // ~5s of retries
    }

    const handlePopState = () => {
      const filename = readImageFromUrl();
      const store = useAppStore.getState();
      syncFromPopState = true;
      try {
        if (filename) {
          const target = store.history.find((h) => h.filename === filename);
          if (target) {
            store.openLightbox(filename);
          } else {
            // Stale filename in URL (deleted or not in current session).
            // Close the lightbox rather than leaving it on a different image.
            if (store.lightboxOpen) store.closeLightbox();
          }
        } else {
          if (store.lightboxOpen) store.closeLightbox();
        }
      } finally {
        syncFromPopState = false;
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
}
