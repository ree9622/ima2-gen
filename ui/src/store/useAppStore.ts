import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Count,
  Format,
  GenerateItem,
  GenerateResponse,
  Moderation,
  Provider,
  Quality,
  SizePreset,
  UIMode,
} from "../types";
import { isMultiResponse } from "../types";
import {
  postGenerate,
  getHistory,
  getInflight,
  cancelInflight,
  postNodeGenerateStream,
  postNodeImportHistory,
  setFavorite,
  listSessions as apiListSessions,
  createSession as apiCreateSession,
  getSession as apiGetSession,
  renameSession as apiRenameSession,
  deleteSession as apiDeleteSession,
  saveSessionGraph,
  reconcileOrphans,
  getNodeResult,
  type SessionSummary,
  type SessionFull,
  type HistoryItem,
  type InflightJob,
} from "../lib/api";
import { compressImage } from "../lib/image";
import { resizeDataUrlForRef } from "../lib/refResize";
import { snap16 } from "../lib/size";
import { syncImageToUrl } from "../lib/urlSync";
import { newClientNodeId, type ClientNodeId } from "../lib/graph";
import {
  getNextRootPosition,
  getNextChildPosition,
  layoutGraph,
  type LayoutDirection,
} from "../lib/nodeLayout";
import {
  applyComponentSelection,
  applySelectedNodeIds,
  getSelectedNodeIds,
} from "../lib/nodeSelection";
import {
  nodeHasImage,
  topologicalSortSelected,
  validateBatchDependencies,
} from "../lib/nodeBatch";
import type { PresetPayload } from "../lib/presets";
import {
  loadTrash,
  saveTrash,
  makeTrashItem,
  type TrashItem,
} from "../lib/nodeTrash";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";

function loadRightPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem("ima2.rightPanelOpen");
    if (raw === null) return true;
    return JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

function loadUIMode(): UIMode {
  try {
    const raw = localStorage.getItem("ima2.uiMode");
    if (raw === "node" || raw === "classic") return raw;
  } catch {}
  return "classic";
}

function clampMaxAttempts(n: number): number {
  if (!Number.isFinite(n)) return 3;
  const i = Math.floor(n);
  if (i < 1) return 1;
  if (i > 10) return 10;
  return i;
}

function loadMaxAttempts(): number {
  try {
    const raw = localStorage.getItem("ima2.maxAttempts");
    // 2026-04-29: default raised 3 → 7 to match the new safety-retry
    // pipeline (justifyA, justifyB, KO wrapper, strong-L2, strong-L3,
    // fashion-L4 + LLM rewrite at the tail). With maxAttempts=3 the cycle
    // stopped at justifyB and never reached the substitution wrappers,
    // making the upgraded pipeline a no-op for skin-related rejections.
    if (raw == null) return 7;
    const n = Number(JSON.parse(raw));
    return clampMaxAttempts(n);
  } catch {
    return 7;
  }
}

function saveMaxAttempts(n: number): void {
  try {
    localStorage.setItem("ima2.maxAttempts", JSON.stringify(clampMaxAttempts(n)));
  } catch {}
}


// Activity log entry: in-flight items used to be ephemeral, but the user wants
// them to persist after success/failure with color cues + retry. We keep the
// localStorage key `ima2.inFlight` for backwards compatibility with older
// browser tabs, but the shape now carries terminal state too.
export type ActivityStatus = "running" | "success" | "error";

export type ActivityRetryPayload = {
  kind: "classic" | "node";
  prompt: string;
  // classic-only:
  count?: number;
  // node-only:
  clientNodeId?: ClientNodeId;
};

export type PersistedInFlight = {
  id: string;
  prompt: string;
  startedAt: number;
  phase?: string;
  status?: ActivityStatus;
  attempt?: number;
  maxAttempts?: number;
  endedAt?: number;
  elapsedMs?: number;
  errorMessage?: string;
  retry?: ActivityRetryPayload;
  // For success entries: history filename so clicking the activity item
  // can switch the main view (classic) or focus the node (node mode).
  filename?: string;
  // Recovery metadata — used after refresh to re-scope polling and rebuild
  // node parent links. Server stores these in `meta` (see lib/inflight.js)
  // and the SQLite-backed registry preserves them across restart.
  kind?: "classic" | "node";
  sessionId?: string | null;
  parentNodeId?: string | null;
  clientNodeId?: ClientNodeId;
};

const INFLIGHT_TTL_MS = 180_000;            // running TTL (legacy guard against stuck items)

// upstream 73f228e 흡수: 같은 노드에서 generate 가 동시에 두 번 호출되지 않게
// module-level Map 으로 잠금. React state 가 disabled 로 전환되기 전 빠른 더블
// 클릭 / StrictMode dev 재호출 등을 막는다.
//
// Map(id → acquired-at ms) + TTL: 동기 setup(saveInFlight / set / polling)에서
// 예외가 나서 lock 해제 경로를 못 타는 corner case가 생겨도 TTL 경과 후엔
// 같은 노드를 다시 누를 수 있게 자동 escape. stale 노드에서 "생성 눌러도
// 변화 없음" 증상의 가장 유력한 원인이었음.
const NODE_GEN_LOCK_TTL_MS = 60_000;
const nodeGenerationLocks = new Map<string, number>();
function isNodeGenLocked(id: string): boolean {
  const acquiredAt = nodeGenerationLocks.get(id);
  if (acquiredAt === undefined) return false;
  if (Date.now() - acquiredAt > NODE_GEN_LOCK_TTL_MS) {
    nodeGenerationLocks.delete(id);
    return false;
  }
  return true;
}
const ACTIVITY_SUCCESS_TTL_MS = 10 * 60_000; // 10 min
const ACTIVITY_ERROR_TTL_MS = 24 * 60 * 60_000; // 24 h
const ACTIVITY_MAX_ENTRIES = 50;

function activityTtlMs(item: PersistedInFlight): number {
  switch (item.status) {
    case "success": return ACTIVITY_SUCCESS_TTL_MS;
    case "error": return ACTIVITY_ERROR_TTL_MS;
    default: return INFLIGHT_TTL_MS;
  }
}

function isExpired(item: PersistedInFlight, now: number): boolean {
  const stamp = item.endedAt ?? item.startedAt;
  return now - stamp > activityTtlMs(item);
}

function loadInFlight(): PersistedInFlight[] {
  try {
    const raw = localStorage.getItem("ima2.inFlight");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    const items: PersistedInFlight[] = [];
    for (const x of arr) {
      if (!x || typeof x.id !== "string" || typeof x.prompt !== "string") continue;
      if (typeof x.startedAt !== "number") continue;
      const item: PersistedInFlight = {
        id: x.id,
        prompt: x.prompt,
        startedAt: x.startedAt,
        phase: typeof x.phase === "string" ? x.phase : undefined,
        status: x.status === "success" || x.status === "error" ? x.status : "running",
        attempt: typeof x.attempt === "number" ? x.attempt : undefined,
        maxAttempts: typeof x.maxAttempts === "number" ? x.maxAttempts : undefined,
        endedAt: typeof x.endedAt === "number" ? x.endedAt : undefined,
        elapsedMs: typeof x.elapsedMs === "number" ? x.elapsedMs : undefined,
        errorMessage: typeof x.errorMessage === "string" ? x.errorMessage : undefined,
        filename: typeof x.filename === "string" ? x.filename : undefined,
        kind: x.kind === "classic" || x.kind === "node" ? x.kind : undefined,
        sessionId: typeof x.sessionId === "string" ? x.sessionId : null,
        parentNodeId: typeof x.parentNodeId === "string" ? x.parentNodeId : null,
        clientNodeId:
          typeof x.clientNodeId === "string" ? (x.clientNodeId as ClientNodeId) : undefined,
        retry:
          x.retry && typeof x.retry === "object" && typeof x.retry.prompt === "string"
            ? {
                kind: x.retry.kind === "node" ? "node" : "classic",
                prompt: x.retry.prompt,
                count: typeof x.retry.count === "number" ? x.retry.count : undefined,
                clientNodeId:
                  typeof x.retry.clientNodeId === "string"
                    ? (x.retry.clientNodeId as ClientNodeId)
                    : undefined,
              }
            : undefined,
      };
      if (!isExpired(item, now)) items.push(item);
    }
    // Newest first, then cap.
    items.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
    return items.slice(0, ACTIVITY_MAX_ENTRIES);
  } catch {
    return [];
  }
}

function saveInFlight(list: PersistedInFlight[]): void {
  try {
    localStorage.setItem("ima2.inFlight", JSON.stringify(list));
  } catch (err) {
    // Quota exceeded or storage disabled. Notify the user once per tab.
    const w = window as unknown as { __ima2QuotaWarned?: boolean };
    if (!w.__ima2QuotaWarned) {
      w.__ima2QuotaWarned = true;
      console.warn("[ima2] localStorage write failed:", err);
      try {
        useAppStore.getState().showToast("로컬 저장소가 가득 차서 최근 상태가 저장되지 않을 수 있습니다.", true);
      } catch {}
    }
  }
}

// Extract recovery metadata from a server inflight job. Server stores
// kind/sessionId/parentNodeId/clientNodeId either at the top level (kind)
// or inside `meta`. Returns undefined-where-absent so callers can spread
// the result and only override known fields.
function extractInflightMeta(job: InflightJob): {
  kind?: "classic" | "node";
  sessionId: string | null;
  parentNodeId: string | null;
  clientNodeId?: ClientNodeId;
} {
  const meta = job.meta && typeof job.meta === "object" ? job.meta : {};
  const metaKind = (meta as { kind?: unknown }).kind;
  const kind =
    job.kind === "classic" || job.kind === "node"
      ? job.kind
      : metaKind === "classic" || metaKind === "node"
        ? (metaKind as "classic" | "node")
        : undefined;
  const metaSessionId = (meta as { sessionId?: unknown }).sessionId;
  const metaParentNodeId = (meta as { parentNodeId?: unknown }).parentNodeId;
  const metaClientNodeId = (meta as { clientNodeId?: unknown }).clientNodeId;
  return {
    kind,
    sessionId: typeof metaSessionId === "string" ? metaSessionId : null,
    parentNodeId: typeof metaParentNodeId === "string" ? metaParentNodeId : null,
    clientNodeId:
      typeof metaClientNodeId === "string"
        ? (metaClientNodeId as ClientNodeId)
        : undefined,
  };
}

// Centralized debug logger. Toggle via `localStorage["ima2.debug"] = "1"` or
// `?ima2_debug=1` on the URL — defaults to on for our self-hosted deploy
// because the in-flight reconcile logic is the source of most "ghost
// generation" bug reports. Output flows to the browser DevTools console with
// a stable [ima2:topic] prefix so it can be filtered.
const IMA2_DEBUG = (() => {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("ima2_debug") === "1") return true;
    if (url.searchParams.get("ima2_debug") === "0") return false;
    const stored = localStorage.getItem("ima2.debug");
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {}
  return true;
})();
function dlog(topic: string, ...args: unknown[]): void {
  if (!IMA2_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(`[ima2:${topic}]`, ...args);
}
function dwarn(topic: string, ...args: unknown[]): void {
  if (!IMA2_DEBUG) return;
  // eslint-disable-next-line no-console
  console.warn(`[ima2:${topic}]`, ...args);
}

// Match running in-flight entries against history rows that carry the same
// requestId. Promotes any matched entry from "running" → "success" and links
// the resulting filename. Used by both reconcileInflight (one-shot on load)
// and the polling tick (continuous). Lives at module scope so the helper can
// be reused without going through the zustand `set` indirection twice.
function reconcileWithHistoryItems(
  items: HistoryItem[],
  get: () => InflightAccess,
  set: (partial: Partial<InflightAccess>) => void,
): number {
  const byReq = new Map<string, HistoryItem>();
  for (const it of items) {
    if (typeof it.requestId === "string" && it.requestId) {
      byReq.set(it.requestId, it);
    }
  }
  if (byReq.size === 0) return 0;
  const local = get().inFlight;
  let matched = 0;
  const next = local.map((f) => {
    // Promote both running AND error rows: a refresh-during-fetch can land
    // the entry in "error" before the unloading guard sees beforeunload, but
    // the server still finishes and writes the sidecar. We must recover that
    // row when its requestId shows up in history. Already-success rows are
    // left alone so a stale history slice can't downgrade newer state.
    if (f.status === "success") return f;
    const hit = byReq.get(f.id);
    if (!hit) return f;
    matched++;
    const endedAt = hit.createdAt || Date.now();
    return {
      ...f,
      status: "success" as const,
      endedAt,
      elapsedMs: endedAt - f.startedAt,
      filename: hit.filename,
      phase: undefined,
    };
  });
  if (matched > 0) {
    dlog("inflight", "rescued via history match:", matched);
    saveInFlight(next);
    set({
      inFlight: next,
      activeGenerations: next.filter((f) => (f.status ?? "running") === "running").length,
    });
  }
  return matched;
}

// Slim view of the store fields the helper above needs. Avoids importing the
// full Store type (which would create a forward reference).
type InflightAccess = {
  inFlight: PersistedInFlight[];
  activeGenerations: number;
};

// Page-unload guard: when the user navigates away or refreshes, in-flight
// fetches abort and would otherwise hit the generate/generateNode catch
// blocks, marking the activity entry as "error". The server still owns
// the request (the upstream OAuth call keeps running), so on the next
// page load `reconcileInflight` should restore it as running. We set this
// flag from beforeunload/visibilitychange and skip the local error-mark
// when it's set.
let unloading = false;
if (typeof window !== "undefined") {
  const markUnloading = () => { unloading = true; };
  const clearUnloading = () => { unloading = false; };
  window.addEventListener("beforeunload", markUnloading);
  window.addEventListener("pagehide", markUnloading);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") markUnloading();
    else clearUnloading();
  });
}

function loadSelectedFilename(): string | null {
  try {
    const raw = localStorage.getItem("ima2.selectedFilename");
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveSelectedFilename(filename: string | null): void {
  try {
    if (filename) localStorage.setItem("ima2.selectedFilename", filename);
    else localStorage.removeItem("ima2.selectedFilename");
  } catch {}
}

// Slice of state reset on every login/logout so account switching never
// leaks the previous user's data through the store. Covers everything
// scoped to a single account: history, currently-selected image, graph
// sessions (nodes / edges), bundles, reference images, in-flight rows.
// Right-panel preferences (quality / size / count / format / moderation)
// are device-scoped, NOT user-scoped, so they intentionally survive a
// logout. Each array is freshly allocated so callers can mutate without
// aliasing.
function userScopedResetSlice() {
  return {
    history: [] as GenerateItem[],
    currentImage: null as GenerateItem | null,
    sessions: [] as SessionSummary[],
    activeSessionId: null as string | null,
    activeSessionGraphVersion: 0,
    graphNodes: [] as GraphNode[],
    graphEdges: [] as GraphEdge[],
    promptBundles: [] as PromptBundle[],
    refBundles: [] as RefBundle[],
    referenceImages: [] as string[],
    referenceMetaHints: [] as (import("../types").ReferenceMetaHint | null)[],
    inFlight: [] as PersistedInFlight[],
  };
}

function clearUserScopedLocalStorage(): void {
  try {
    localStorage.removeItem("ima2.selectedFilename");
    localStorage.removeItem("ima2.inFlight");
  } catch {}
}

const HISTORY_LIMIT = 3000;
const MAX_NODE_REFS = 5;

export type ImageNodeStatus =
  | "empty"
  | "pending"
  | "reconciling"
  | "ready"
  | "stale"
  | "asset-missing"
  | "error";

export type ImageNodeData = {
  clientId: ClientNodeId;
  serverNodeId: string | null;
  parentServerNodeId: string | null;
  prompt: string;
  imageUrl: string | null;
  status: ImageNodeStatus;
  pendingRequestId: string | null;
  pendingPhase?: string | null;
  error?: string;
  elapsed?: number;
  webSearchCalls?: number;
  // Resolved generation size ("1024x1024", "1536x1024", ...). Drives the
  // node card aspect ratio so non-square outputs aren't letterboxed.
  size?: string | null;
  // Latest partial image (data: URL) emitted while the upstream is still
  // generating. Cleared once the final image arrives.
  partialImageUrl?: string | null;
  // Node-local reference images (data URLs). Persisted with the graph save
  // so a node can be regenerated standalone without depending on the
  // session's transient referenceImages slot.
  referenceImages?: string[];
  // When true, all descendant nodes (and the edges leading to them) are
  // hidden in the canvas. Persisted with the graph so the collapsed state
  // survives reload / session switch.
  collapsed?: boolean;
  // Optional color tag for grouping ("실험 1", "실험 2" etc.). Persisted.
  // Undefined / "" means no tag. Validated against COLOR_TAGS at hydrate.
  colorTag?: ColorTag;
};

export type ColorTag = "red" | "amber" | "green" | "blue" | "purple";

export const COLOR_TAGS: { value: ColorTag; label: string; hex: string }[] = [
  { value: "red", label: "빨강", hex: "#ef4444" },
  { value: "amber", label: "주황", hex: "#f59e0b" },
  { value: "green", label: "초록", hex: "#22c55e" },
  { value: "blue", label: "파랑", hex: "#3b82f6" },
  { value: "purple", label: "보라", hex: "#a855f7" },
];

const COLOR_TAG_VALUES = new Set(COLOR_TAGS.map((t) => t.value));

export type GraphNode = FlowNode<ImageNodeData>;
export type GraphEdge = FlowEdge;

function mapSessionToGraph(session: SessionFull): {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphVersion: number;
} {
  const graphNodes: GraphNode[] = session.nodes.map((n) => {
    const d = (n.data ?? {}) as Partial<ImageNodeData>;
    const explicitImageUrl =
      typeof d.imageUrl === "string" && d.imageUrl.length > 0 ? d.imageUrl : null;
    const fallbackImageUrl =
      typeof d.serverNodeId === "string" && d.serverNodeId.length > 0
        ? `/generated/${d.serverNodeId}.png`
        : null;
    const imageUrl = explicitImageUrl ?? fallbackImageUrl;
    const data: ImageNodeData = {
      clientId: n.id as ClientNodeId,
      serverNodeId: (d.serverNodeId ?? null) as string | null,
      parentServerNodeId: (d.parentServerNodeId ?? null) as string | null,
      prompt: typeof d.prompt === "string" ? d.prompt : "",
      imageUrl,
      status: (d.status ?? (imageUrl ? "ready" : "empty")) as ImageNodeStatus,
      pendingRequestId: (d.pendingRequestId ?? null) as string | null,
      pendingPhase: (d.pendingPhase ?? null) as string | null,
      error: d.error as string | undefined,
      elapsed: d.elapsed as number | undefined,
      webSearchCalls: d.webSearchCalls as number | undefined,
      size: typeof d.size === "string" ? d.size : null,
      referenceImages: Array.isArray(d.referenceImages)
        ? d.referenceImages.filter(
            (r): r is string => typeof r === "string" && r.startsWith("data:"),
          )
        : undefined,
      collapsed: d.collapsed === true ? true : undefined,
      colorTag:
        typeof d.colorTag === "string" && COLOR_TAG_VALUES.has(d.colorTag as ColorTag)
          ? (d.colorTag as ColorTag)
          : undefined,
    };
    return {
      id: n.id,
      type: "imageNode",
      position: { x: n.x, y: n.y },
      data,
    };
  });
  const graphEdges: GraphEdge[] = session.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  return {
    graphNodes,
    graphEdges,
    graphVersion: session.graphVersion,
  };
}

type ToastState = { message: string; error: boolean; id: number } | null;

export type RefBundleItem = {
  hash: string;
  sourceUrl: string;
  kind?: "history" | "uploaded";
  filename?: string;
};

export type RefBundle = {
  id: string;
  name: string;
  owner?: string;
  items: RefBundleItem[];
  createdAt: number;
};

// Saved prompt bundle (text-only). Server CRUD lives at /api/prompt-bundles
// and parallels ref-bundles. Apply replaces the composer's prompt text.
export type PromptBundle = {
  id: string;
  name: string;
  prompt: string;
  tags?: string[];
  owner?: string;
  createdAt: number;
  updatedAt?: number;
};

// Logged-in user (null when unauthenticated, undefined while we're still
// resolving the initial /api/auth/me probe — App uses this to render a
// brief "loading" state instead of flashing the LoginPage).
export type AuthUser = { id: number; username: string };
export type AuthState =
  | { status: "loading"; user: null; authEnabled: boolean }
  | { status: "anonymous"; user: null; authEnabled: boolean }
  | { status: "authed"; user: AuthUser; authEnabled: boolean };

type AppState = {
  provider: Provider;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
  count: Count;
  prompt: string;
  referenceImages: string[];
  // Lineage hint per reference, index-aligned with referenceImages. The store
  // keeps the two arrays in lock-step (length always equal). null entries
  // mean we have no hint and the server should treat the ref as uploaded.
  referenceMetaHints: (import("../types").ReferenceMetaHint | null)[];
  addReferences: (files: File[]) => Promise<void>;
  addReferenceDataUrl: (dataUrl: string) => Promise<void>;
  removeReference: (index: number) => void;
  clearReferences: () => void;
  useCurrentAsReference: () => Promise<void>;
  // Reference bundles: save current refs by name, reapply later.
  refBundles: RefBundle[];
  refBundlesLoading: boolean;
  loadRefBundles: () => Promise<void>;
  saveRefBundle: (name: string) => Promise<RefBundle | null>;
  applyRefBundle: (id: string, opts?: { append?: boolean }) => Promise<void>;
  deleteRefBundle: (id: string) => Promise<void>;
  renameRefBundle: (id: string, name: string) => Promise<void>;
  // Auth — self-hosted login. Drives App's gate between LoginPage and the
  // main UI. `auth.status === "loading"` until the first /api/auth/me
  // probe resolves on mount.
  auth: AuthState;
  loginError: string | null;
  loginPending: boolean;
  checkAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  // Prompt bundles — same CRUD shape as ref bundles, text-only payload.
  promptBundles: PromptBundle[];
  promptBundlesLoading: boolean;
  loadPromptBundles: () => Promise<void>;
  savePromptBundle: (name: string, opts?: { tags?: string[] }) => Promise<PromptBundle | null>;
  applyPromptBundle: (id: string) => void;
  deletePromptBundle: (id: string) => Promise<void>;
  updatePromptBundle: (
    id: string,
    patch: { name?: string; prompt?: string; tags?: string[] },
  ) => Promise<void>;
  activeGenerations: number;
  inFlight: PersistedInFlight[];
  startInFlightPolling: () => void;
  reconcileInflight: () => Promise<void>;
  reconcileGraphPending: () => Promise<void>;
  reconcileOrphansFromDisk: () => Promise<void>;
  syncFromStorage: () => void;
  dismissActivity: (id: string) => void;
  clearActivityHistory: () => void;
  retryActivity: (id: string) => Promise<void>;
  cancelActivity: (id: string) => void;
  selectActivity: (id: string) => void;
  currentImage: GenerateItem | null;
  history: GenerateItem[];
  toast: ToastState;
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  galleryOpen: boolean;
  galleryFavOnly: boolean;
  openGallery: (opts?: { favOnly?: boolean }) => void;
  closeGallery: () => void;
  setGalleryFavOnly: (v: boolean) => void;
  lightboxOpen: boolean;
  openLightbox: (filename?: string | null) => void;
  closeLightbox: () => void;
  lightboxNext: () => void;
  lightboxPrev: () => void;
  jumpToImageSession: (item?: GenerateItem | null) => Promise<void>;

  uiMode: UIMode;
  setUIMode: (m: UIMode) => void;

  // 갤러리 click 등으로 "이 노드로 화면을 이동시켜 달라"는 요청을 store에
  // 남긴다. NodeCanvas의 useEffect가 reactflow fitView를 호출한 뒤 클리어.
  pendingFocusNodeId: ClientNodeId | null;
  setPendingFocusNodeId: (id: ClientNodeId | null) => void;

  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  setGraphNodes: (n: GraphNode[]) => void;
  setGraphEdges: (e: GraphEdge[]) => void;
  disconnectEdges: (ids: string[]) => void;
  autoLayoutGraph: (direction?: LayoutDirection) => void;
  toggleNodeCollapsed: (clientId: ClientNodeId) => void;
  setNodeColorTag: (clientId: ClientNodeId, tag: ColorTag | null) => void;

  // Search / filter (client-side only — does not hit the server). Empty
  // text + empty status set means "no filter active".
  nodeFilterText: string;
  nodeFilterStatuses: ImageNodeStatus[];
  setNodeFilterText: (text: string) => void;
  toggleNodeFilterStatus: (status: ImageNodeStatus) => void;
  clearNodeFilters: () => void;

  // Trash (client-side, localStorage-backed). Lets users undo accidental
  // deletes within 7 days without bringing in a full undo/redo system.
  trashedItems: TrashItem[];
  trashOpen: boolean;
  setTrashOpen: (open: boolean) => void;
  restoreFromTrash: (trashId: string) => void;
  purgeTrashItem: (trashId: string) => void;
  emptyTrash: () => void;
  addRootNode: () => ClientNodeId;
  importHistoryAsRootNode: (item: GenerateItem) => Promise<ClientNodeId | null>;
  addChildNode: (parentClientId: ClientNodeId) => ClientNodeId;
  addSiblingNode: (sourceClientId: ClientNodeId) => ClientNodeId;
  duplicateBranchRoot: (sourceClientId: ClientNodeId) => ClientNodeId;
  addChildNodeAt: (parentClientId: ClientNodeId, position: { x: number; y: number }) => ClientNodeId;
  connectNodes: (sourceClientId: ClientNodeId, targetClientId: ClientNodeId) => void;
  updateNodePrompt: (clientId: ClientNodeId, prompt: string) => void;
  // Node-local references — only allowed on root nodes (parent edit mode
  // already passes the parent image as the visual source).
  addNodeReferences: (clientId: ClientNodeId, files: File[]) => Promise<void>;
  removeNodeReference: (clientId: ClientNodeId, index: number) => void;
  clearNodeReferences: (clientId: ClientNodeId) => void;
  generateNode: (clientId: ClientNodeId) => Promise<void>;
  addSiblingAndGenerate: (sourceClientId: ClientNodeId) => Promise<void>;
  deleteNodesByFilename: (filename: string) => number;
  // Fan-out: clone a parent node's prompt into N fresh children and run
  // them in parallel. Lets users explore variants without 3 manual clicks.
  fanOutFromNode: (parentClientId: ClientNodeId, count?: number) => Promise<void>;
  deleteNode: (clientId: ClientNodeId) => void;
  deleteNodes: (clientIds: ClientNodeId[]) => void;

  // Node batch selection (Phase 4.2 sub-PR 5)
  nodeSelectionMode: boolean;
  nodeBatchRunning: boolean;
  nodeBatchStopping: boolean;
  toggleNodeSelectionMode: () => void;
  selectAllGraphNodes: () => void;
  selectNodeGraph: (clientId: ClientNodeId, additive: boolean) => void;
  clearNodeSelection: () => void;
  runNodeBatch: (mode: "missing-only" | "regenerate-all") => Promise<void>;
  cancelNodeBatch: () => void;

  // Sessions (0.06)
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSessionGraphVersion: number | null;
  sessionLoading: boolean;
  loadSessions: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  createAndSwitchSession: (title?: string) => Promise<void>;
  renameCurrentSession: (title: string) => Promise<void>;
  deleteSessionById: (id: string) => Promise<void>;
  scheduleGraphSave: () => void;
  flushGraphSave: (reason?: "debounced" | "manual" | "switch-session" | "recovery" | "beforeunload" | "queued" | "retry-after-fail" | "delete-with-nodes") => Promise<void>;

  setProvider: (p: Provider) => void;
  setQuality: (q: Quality) => void;
  setSizePreset: (s: SizePreset) => void;
  setCustomSize: (w: number, h: number) => void;
  setFormat: (f: Format) => void;
  setModeration: (m: Moderation) => void;
  setCount: (c: Count) => void;
  setPrompt: (p: string) => void;
  // Restore prompt + size + quality + moderation + fork extras from a PNG's
  // ima2:* tEXt chunks. Fields not present in the metadata are left untouched
  // (Phase 6.2 + fork extension). fork.originalPrompt 와 fork.maxAttempts 까지
  // 같이 복원돼서 "이대로 채우기" 한 번으로 sexy-tune 시리즈 재현 준비가 끝난다.
  restoreFromImageMetadata: (meta: {
    prompt?: string;
    size?: string;
    quality?: string;
    moderation?: string;
    fork?: {
      originalPrompt?: string;
      outfit?: unknown;
      maxAttempts?: string;
      batchId?: string;
      batchIndex?: string;
      referenceCount?: string;
    };
  }) => void;
  // Original (pre-enhance) prompt — set by EnhanceModal.onApply, cleared on
  // direct edits or external prompt changes. Used so generate / sidecar can
  // record what the user originally typed before the enhance rewrite.
  originalPrompt: string | null;
  applyEnhancedPrompt: (original: string, enhanced: string) => void;
  clearOriginalPrompt: () => void;
  revertToOriginalPrompt: () => void;
  maxAttempts: number;
  setMaxAttempts: (n: number) => void;
  /** Unix ms until which generate() refuses to call /api/generate. Set when
   *  the upstream returns USAGE_LIMIT (429). null = no cool-down active. */
  usageLimitedUntil: number | null;
  setUsageLimitedUntil: (ts: number | null) => void;
  logModalOpen: boolean;
  openLogModal: () => void;
  closeLogModal: () => void;
  // Prompt library (Phase 6.3) — 자주 쓰는 프롬프트 SQLite 저장 + 검색.
  promptLibraryOpen: boolean;
  promptLibraryItems: import("../lib/api").PromptItem[];
  promptLibraryQuery: string;
  promptLibraryLoading: boolean;
  openPromptLibrary: () => void;
  closePromptLibrary: () => void;
  setPromptLibraryQuery: (q: string) => void;
  loadPromptLibrary: () => Promise<void>;
  savePromptToLibrary: (title: string, body: string) => Promise<void>;
  applyPromptFromLibrary: (id: string) => Promise<void>;
  deletePromptFromLibrary: (id: string) => Promise<void>;
  togglePinPromptFromLibrary: (id: string) => Promise<void>;
  renamePromptInLibrary: (id: string, title: string) => Promise<void>;
  importPromptsFromGitHub: (url: string) => Promise<{ created: number; skipped: number }>;
  retryFromLog: (item: import("../types").GenerationLogItem) => Promise<void>;
  applyPreset: (payload: PresetPayload) => void;
  selectHistory: (item: GenerateItem) => void;
  removeFromHistory: (filename: string) => void;
  addHistoryItem: (item: GenerateItem) => void;
  toggleFavorite: (filename?: string) => Promise<void>;
  generate: (overrides?: {
    overridePrompt?: string;
    overrideCount?: Count;
    outfitModule?: import("../types").OutfitModuleMeta;
    overrideReferences?: string[];
    overrideSize?: string;
    overrideQuality?: Quality;
    // When set, every /api/generate call this action emits will carry the
    // batch headers so the server can append entries to
    // generated/.batches/<batchId>/<index>.json. The caller (e.g. the txt-
    // batch handler) is responsible for minting batchId once and assigning
    // a unique batchIndex per prompt.
    batchId?: string;
    batchIndex?: number;
    batchTotal?: number;
    batchSource?: string;
  }) => Promise<void>;
  runSexyTuneBatch: (opts: {
    count: number;
    maxRisk?: "low" | "medium" | "high";
    categories?: string[];
    aspectRatio?: string;
    cameraTone?: "iphone" | "canon";
    includeMirror?: boolean;
    includeFlirty?: boolean;
    autoFillOnFail?: boolean;
    maxResolution?: boolean;
    framingMode?: "mixed" | "full-body" | "half-body";
    aestheticMode?: "amateur" | "editorial" | "glamour" | "off";
  }) => Promise<void>;
  varyCurrentResult: () => Promise<void>;
  hydrateHistory: () => void;
  showToast: (message: string, error?: boolean) => void;
  getResolvedSize: () => string;
};

// Right-panel options (count / quality / size / format / moderation) used to
// reset on every reload because nothing was persisting them. We wrap the
// store with zustand's `persist` middleware and keep the partialize list
// minimal: ONLY the right-panel inputs survive a reload. Larger derived
// state (refs, history, inFlight, sessions) is intentionally excluded — it
// either has its own dedicated persistence layer (history disk, inflight
// localStorage via reconcileInflight) or is too big / sensitive to mirror
// here. `maxAttempts` already has bespoke load/save (loadMaxAttempts /
// saveMaxAttempts) so it stays out of partialize to avoid two writers
// fighting over the same setting.
export const useAppStore = create<AppState>()(persist((set, get) => ({
  provider: "oauth",
  quality: "high",
  sizePreset: "auto",
  customW: 1920,
  customH: 1088,
  format: "png",
  moderation: "low",
  count: 1,
  prompt: "",
  maxAttempts: loadMaxAttempts(),
  usageLimitedUntil: (() => {
    try {
      const raw = localStorage.getItem("ima2.usageLimitedUntil");
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return n > Date.now() ? n : null;
    } catch {
      return null;
    }
  })(),
  setUsageLimitedUntil: (ts) => {
    try {
      if (ts && ts > Date.now()) {
        localStorage.setItem("ima2.usageLimitedUntil", String(ts));
      } else {
        localStorage.removeItem("ima2.usageLimitedUntil");
      }
    } catch {}
    set({ usageLimitedUntil: ts && ts > Date.now() ? ts : null });
  },
  setMaxAttempts: (n) => {
    const v = clampMaxAttempts(n);
    saveMaxAttempts(v);
    set({ maxAttempts: v });
  },
  logModalOpen: false,
  openLogModal: () => set({ logModalOpen: true }),
  closeLogModal: () => set({ logModalOpen: false }),

  // Prompt library actions (Phase 6.3)
  promptLibraryOpen: false,
  promptLibraryItems: [],
  promptLibraryQuery: "",
  promptLibraryLoading: false,
  openPromptLibrary: () => {
    set({ promptLibraryOpen: true });
    void get().loadPromptLibrary();
  },
  closePromptLibrary: () => set({ promptLibraryOpen: false }),
  setPromptLibraryQuery: (q) => {
    set({ promptLibraryQuery: q });
    void get().loadPromptLibrary();
  },
  loadPromptLibrary: async () => {
    set({ promptLibraryLoading: true });
    try {
      const api = await import("../lib/api");
      const { items } = await api.listPrompts(get().promptLibraryQuery);
      set({ promptLibraryItems: items });
    } catch (err) {
      console.error("[promptLibrary] load failed", err);
      get().showToast("프롬프트 목록을 불러올 수 없습니다", true);
    } finally {
      set({ promptLibraryLoading: false });
    }
  },
  savePromptToLibrary: async (title, body) => {
    const trimmed = body.trim();
    if (!trimmed) {
      get().showToast("저장할 프롬프트가 비어있습니다", true);
      return;
    }
    try {
      const api = await import("../lib/api");
      await api.createPrompt(title, trimmed);
      get().showToast("프롬프트를 저장했습니다", false);
      if (get().promptLibraryOpen) await get().loadPromptLibrary();
    } catch (err) {
      console.error("[promptLibrary] save failed", err);
      get().showToast("저장 실패", true);
    }
  },
  importPromptsFromGitHub: async (url) => {
    try {
      const api = await import("../lib/api");
      const result = await api.importPromptsFromGitHub(url);
      const createdN = result.created.length;
      const skippedN = result.skipped.length;
      const msg = createdN > 0
        ? `${createdN}개 프롬프트 가져옴${skippedN ? ` (skip ${skippedN})` : ""}`
        : skippedN ? `가져올 새 프롬프트 없음 (skip ${skippedN})` : "가져올 프롬프트 없음";
      get().showToast(msg, createdN === 0);
      if (get().promptLibraryOpen) await get().loadPromptLibrary();
      return { created: createdN, skipped: skippedN };
    } catch (err) {
      console.error("[promptLibrary] github import failed", err);
      const msg = err instanceof Error ? err.message : "GitHub 가져오기 실패";
      get().showToast(msg, true);
      return { created: 0, skipped: 0 };
    }
  },
  applyPromptFromLibrary: async (id) => {
    const item = get().promptLibraryItems.find((p) => p.id === id);
    if (!item) return;
    set({ prompt: item.body, originalPrompt: null, promptLibraryOpen: false });
    try {
      const api = await import("../lib/api");
      await api.bumpPromptUse(id);
    } catch (err) {
      console.warn("[promptLibrary] use bump failed (non-fatal)", err);
    }
  },
  deletePromptFromLibrary: async (id) => {
    try {
      const api = await import("../lib/api");
      await api.deletePrompt(id);
      set({ promptLibraryItems: get().promptLibraryItems.filter((p) => p.id !== id) });
      get().showToast("삭제했습니다", false);
    } catch (err) {
      console.error("[promptLibrary] delete failed", err);
      get().showToast("삭제 실패", true);
    }
  },
  togglePinPromptFromLibrary: async (id) => {
    const item = get().promptLibraryItems.find((p) => p.id === id);
    if (!item) return;
    try {
      const api = await import("../lib/api");
      await api.updatePrompt(id, { pinned: !item.pinned });
      await get().loadPromptLibrary();
    } catch (err) {
      console.error("[promptLibrary] pin toggle failed", err);
      get().showToast("핀 변경 실패", true);
    }
  },
  renamePromptInLibrary: async (id, title) => {
    try {
      const api = await import("../lib/api");
      await api.updatePrompt(id, { title: title.trim() });
      await get().loadPromptLibrary();
    } catch (err) {
      console.error("[promptLibrary] rename failed", err);
      get().showToast("제목 변경 실패", true);
    }
  },
  retryFromLog: async (item) => {
    if (!item?.prompt) {
      get().showToast("재시도할 프롬프트가 없습니다.", true);
      return;
    }
    const s = get();
    set({
      prompt: item.prompt,
      quality: (item.quality as Quality) || s.quality,
      sizePreset: (item.size as SizePreset) || s.sizePreset,
      format: (item.format as Format) || s.format,
      moderation: (item.moderation as Moderation) || s.moderation,
      logModalOpen: false,
    });
    if (item.referenceCount > 0) {
      get().showToast("참조 이미지는 재시도에 포함되지 않습니다. 필요하면 다시 첨부하세요.", true);
    }
    await get().generate({ overridePrompt: item.prompt, overrideCount: 1 });
  },
  runSexyTuneBatch: async (opts) => {
    const s = get();
    // 2026-04-29 — 참조 사진 없어도 동작. 없으면 random mode (매 컷 다른 얼굴).
    // 참조 있으면 series mode (얼굴 고정, 옷/배경/포즈만 변형).
    const hasReferences = s.referenceImages.length > 0;
    const count = Math.max(1, Math.min(8, Math.floor(opts.count) || 4));
    const autoFill = opts.autoFillOnFail !== false; // default true

    // SNAPSHOT references at batch-start. The user may close the modal
    // immediately and switch to a different reference image (b → c → ...),
    // but this batch must keep using the refs that were attached when
    // they pressed start. generate() honors overrideReferences over store
    // state. In random mode this snapshot is empty by design.
    const refSnapshot = s.referenceImages.map((d) =>
      d.replace(/^data:[^;]+;base64,/, ""),
    );

    // Resolve max-resolution preset based on the requested aspect ratio.
    // Pool template's [퀄리티] tag stays in sync via aspectRatio anyway.
    let overrideSize: string | undefined;
    if (opts.maxResolution) {
      const ar = opts.aspectRatio ?? "1:1";
      // Pixel budget cap is ~8.3M; preset map (from ui/src/lib/size.ts):
      //   1:1   → 2048x2048   (4.2M, 2K square)
      //   16:9  → 3824x2160   (8.3M, 4K landscape)
      //   9:16  → 2160x3824   (8.3M, 4K portrait)
      //   3:4   → 1024x1360 max preset (3:4 doesn't have a 2K+ preset)
      //   2:3   → 1024x1536
      //   4:3   → 1360x1024
      //   3:2   → 1536x1024
      const map: Record<string, string> = {
        "1:1": "2048x2048",
        "16:9": "3824x2160",
        "9:16": "2160x3824",
        "3:4": "1152x1536",
        "4:3": "1536x1152",
        "2:3": "1024x1536",
        "3:2": "1536x1024",
      };
      overrideSize = map[ar] ?? "2048x2048";
    }
    const overrideQuality: Quality | undefined = opts.maxResolution ? "high" : undefined;

    type Variant = {
      id: string;
      label: string;
      category: string;
      risk: "low" | "medium" | "high";
      prompt: string;
      // 2026-04-29 — server-side override for media-category variants.
      // When present, the generate call uses a size matching this aspect
      // ratio regardless of the user's batch-wide aspectRatio choice.
      // See lib/outfitPresets.js composeOutfitPrompt() for context.
      forcedAspectRatio?: string;
    };

    const fetchVariants = async (n: number, excludeIds: string[]): Promise<Variant[]> => {
      const res = await fetch("/api/outfit/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: n,
          maxRisk: opts.maxRisk ?? "medium",
          categories: opts.categories,
          excludeIds,
          aspectRatio: opts.aspectRatio ?? "1:1",
          cameraTone: opts.cameraTone ?? "canon",
          includeMirror: opts.includeMirror ?? false,
          includeFlirty: opts.includeFlirty ?? true,
          framingMode: opts.framingMode ?? "mixed",
          aestheticMode: opts.aestheticMode ?? "amateur",
          useWeights: true,
          hasReferences,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.variants) ? data.variants : [];
    };

    let variants: Variant[];
    try {
      variants = await fetchVariants(count, []);
    } catch (e) {
      s.showToast(`섹시 다듬기 풀 조회 실패: ${(e as Error).message}`, true);
      return;
    }
    if (variants.length === 0) {
      s.showToast("샘플링 결과가 비어 있습니다 (필터 조건 확인).", true);
      return;
    }

    s.showToast(`섹시 다듬기 ${variants.length}장 시작 (각 다른 의상).`);
    console.log(
      `[ima2][sexy-tune] starting batch: count=${variants.length} ` +
      `labels=${variants.map((v) => v.label).join(" / ")}`,
    );

    // Snapshot history size BEFORE the batch so we can derive how many
    // generates actually produced an image. Per-call detection is unreliable
    // under Promise.all because other concurrent calls also bump history.
    // 2026-04-29 — Resolve a per-variant size override when the server
    // marks the variant with forcedAspectRatio (media category → 16:9).
    // We reuse the same aspect→size table as the batch-wide override so
    // maxResolution is honored. Falls back to overrideSize otherwise.
    const sizeForRatio = (ratio: string, hi: boolean): string => {
      const lo: Record<string, string> = {
        "1:1": "1024x1024",
        "16:9": "1824x1024",
        "9:16": "1024x1824",
        "3:4": "1024x1360",
        "4:3": "1360x1024",
        "2:3": "1024x1536",
        "3:2": "1536x1024",
      };
      const high: Record<string, string> = {
        "1:1": "2048x2048",
        "16:9": "3824x2160",
        "9:16": "2160x3824",
        "3:4": "1152x1536",
        "4:3": "1536x1152",
        "2:3": "1024x1536",
        "3:2": "1536x1024",
      };
      return (hi ? high : lo)[ratio] ?? lo["16:9"];
    };

    const fireOne = async (v: Variant): Promise<void> => {
      const variantSize = v.forcedAspectRatio
        ? sizeForRatio(v.forcedAspectRatio, !!opts.maxResolution)
        : overrideSize;
      await get().generate({
        overridePrompt: v.prompt,
        overrideCount: 1,
        outfitModule: {
          id: v.id,
          label: v.label,
          category: v.category,
          risk: v.risk,
        },
        overrideReferences: refSnapshot,
        ...(variantSize ? { overrideSize: variantSize } : {}),
        ...(overrideQuality ? { overrideQuality } : {}),
      });
    };

    const beforeAll = get().history.length;
    await Promise.all(variants.map(fireOne));
    const afterAll = get().history.length;
    const succeeded = Math.max(0, afterAll - beforeAll);
    const failedCount = Math.max(0, variants.length - succeeded);

    console.log(
      `[ima2][sexy-tune] batch result: ${succeeded}/${variants.length} succeeded ` +
      `(${failedCount} failed)`,
    );

    if (autoFill && failedCount > 0) {
      const usedIds = variants.map((v) => v.id);
      console.log(
        `[ima2][sexy-tune] ${failedCount}장 실패 → 다른 의상으로 자동 보충 시도`,
      );
      try {
        const refill = await fetchVariants(failedCount, usedIds);
        if (refill.length > 0) {
          s.showToast(`${refill.length}장 자동 보충 (다른 의상으로 재시도).`);
          await Promise.all(refill.map(fireOne));
          const finalCount = get().history.length - beforeAll;
          console.log(
            `[ima2][sexy-tune] after auto-fill: ${finalCount} total succeeded`,
          );
        }
      } catch (e) {
        console.warn(`[ima2][sexy-tune] 보충 실패: ${(e as Error).message}`);
      }
    }
  },
  referenceImages: [],
  referenceMetaHints: [],
  addReferences: async (files) => {
    const allowed = 5 - get().referenceImages.length;
    const toAdd = files.slice(0, Math.max(0, allowed));
    const dataUrls = await Promise.all(
      toAdd.map(
        (f) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = async () => {
              if (typeof reader.result !== "string") {
                resolve(null);
                return;
              }
              try {
                resolve(await resizeDataUrlForRef(reader.result));
              } catch {
                resolve(reader.result);
              }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          }),
      ),
    );
    const valid = dataUrls.filter((x): x is string => !!x);
    const newHints = valid.map(() => ({ kind: "uploaded" as const }));
    set((s) => ({
      referenceImages: [...s.referenceImages, ...valid].slice(0, 5),
      referenceMetaHints: [...s.referenceMetaHints, ...newHints].slice(0, 5),
    }));
    if (files.length > allowed) {
      get().showToast("참조 이미지는 최대 5장까지 추가할 수 있습니다. 초과한 이미지는 제외되었습니다.", true);
    }
  },
  addReferenceDataUrl: async (dataUrl) => {
    if (get().referenceImages.length >= 5) return;
    let url = dataUrl;
    try {
      url = await resizeDataUrlForRef(dataUrl);
    } catch {
      // fall through with the original — server may still reject if huge
    }
    set((s) =>
      s.referenceImages.length >= 5
        ? s
        : {
            referenceImages: [...s.referenceImages, url],
            referenceMetaHints: [...s.referenceMetaHints, { kind: "uploaded" }],
          },
    );
  },
  removeReference: (index) => {
    set((s) => ({
      referenceImages: s.referenceImages.filter((_, i) => i !== index),
      referenceMetaHints: s.referenceMetaHints.filter((_, i) => i !== index),
    }));
  },
  clearReferences: () => set({ referenceImages: [], referenceMetaHints: [] }),

  refBundles: [],
  refBundlesLoading: false,
  loadRefBundles: async () => {
    set({ refBundlesLoading: true });
    try {
      const res = await fetch("/api/ref-bundles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      set({ refBundles: Array.isArray(j?.bundles) ? j.bundles : [] });
    } catch (e) {
      get().showToast(`묶음 불러오기 실패: ${(e as Error).message}`, true);
    } finally {
      set({ refBundlesLoading: false });
    }
  },
  saveRefBundle: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      get().showToast("묶음 이름을 입력하세요.", true);
      return null;
    }
    const refs = get().referenceImages;
    if (refs.length === 0) {
      get().showToast("저장할 참조 이미지가 없습니다.", true);
      return null;
    }
    try {
      const referencesB64 = refs.map((d) => d.replace(/^data:[^;]+;base64,/, ""));
      const referenceMeta = get().referenceMetaHints.map((h) => h ?? { kind: "uploaded" });
      const res = await fetch("/api/ref-bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, references: referencesB64, referenceMeta }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const j = await res.json();
      const bundle = j.bundle as RefBundle;
      set((s) => ({ refBundles: [bundle, ...s.refBundles] }));
      get().showToast(`묶음 "${bundle.name}" 저장됨 (${bundle.items.length}장).`);
      return bundle;
    } catch (e) {
      get().showToast(`묶음 저장 실패: ${(e as Error).message}`, true);
      return null;
    }
  },
  applyRefBundle: async (id, opts = {}) => {
    const bundle = get().refBundles.find((b) => b.id === id);
    if (!bundle) {
      get().showToast("묶음을 찾을 수 없습니다.", true);
      return;
    }
    const append = opts.append === true;
    const startCount = append ? get().referenceImages.length : 0;
    const room = 5 - startCount;
    if (room <= 0) {
      get().showToast("참조 이미지 슬롯이 가득 찼습니다.", true);
      return;
    }
    const items = bundle.items.slice(0, room);
    const dataUrls: string[] = [];
    const hints: { kind: "history" | "uploaded"; filename?: string }[] = [];
    for (const item of items) {
      try {
        const r = await fetch(item.sourceUrl);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        dataUrls.push(dataUrl);
        hints.push(
          item.kind === "history" && item.filename
            ? { kind: "history", filename: item.filename }
            : { kind: "uploaded" },
        );
      } catch (e) {
        console.warn(`[refBundle] failed to load ${item.sourceUrl}:`, e);
      }
    }
    if (dataUrls.length === 0) {
      get().showToast("묶음에서 이미지를 불러오지 못했습니다.", true);
      return;
    }
    set((s) => ({
      referenceImages: append
        ? [...s.referenceImages, ...dataUrls].slice(0, 5)
        : dataUrls,
      referenceMetaHints: append
        ? [...s.referenceMetaHints, ...hints].slice(0, 5)
        : hints,
    }));
    get().showToast(`묶음 "${bundle.name}" 적용 (${dataUrls.length}장).`);
  },
  deleteRefBundle: async (id) => {
    try {
      const res = await fetch(`/api/ref-bundles/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      set((s) => ({ refBundles: s.refBundles.filter((b) => b.id !== id) }));
      get().showToast("묶음을 삭제했습니다.");
    } catch (e) {
      get().showToast(`묶음 삭제 실패: ${(e as Error).message}`, true);
    }
  },
  renameRefBundle: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      get().showToast("묶음 이름을 입력하세요.", true);
      return;
    }
    try {
      const res = await fetch(`/api/ref-bundles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const j = await res.json();
      const next = j.bundle as RefBundle;
      set((s) => ({ refBundles: s.refBundles.map((b) => (b.id === id ? next : b)) }));
    } catch (e) {
      get().showToast(`이름 변경 실패: ${(e as Error).message}`, true);
    }
  },

  // ─── Auth ────────────────────────────────────────────────────────────────
  auth: { status: "loading", user: null, authEnabled: false },
  loginError: null,
  loginPending: false,
  checkAuth: async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      // Even if the network is up, only 200 means we got a useful answer.
      // Any other code → treat as anonymous so the LoginPage shows up.
      if (!res.ok) {
        set({ auth: { status: "anonymous", user: null, authEnabled: true } });
        return;
      }
      const j = (await res.json()) as { user: AuthUser | null; authEnabled: boolean };
      if (j.user) {
        set({ auth: { status: "authed", user: j.user, authEnabled: !!j.authEnabled } });
      } else {
        set({ auth: { status: "anonymous", user: null, authEnabled: !!j.authEnabled } });
      }
    } catch {
      // Network error during boot — assume anonymous; the user will see the
      // login screen with a "서버에 연결할 수 없습니다" banner once they
      // try to log in.
      set({ auth: { status: "anonymous", user: null, authEnabled: true } });
    }
  },
  login: async (username, password) => {
    set({ loginPending: true, loginError: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        const msg = j?.error?.message || `HTTP ${res.status}`;
        set({ loginError: msg, loginPending: false });
        return false;
      }
      const j = (await res.json()) as { user: AuthUser };
      // Hard reset all user-scoped state on login. Without this, account
      // switching (logout A → login B) would leave A's history / sessions /
      // bundles visible to B until the next API hydrate replaced them, and
      // any A-data that B's hydrate returned an empty result for would
      // STAY visible (see hydrateHistory comment). Clear up front so the
      // worst-case post-login UI is "empty until hydrate finishes" rather
      // than "shows previous user's data".
      set({
        auth: { status: "authed", user: j.user, authEnabled: true },
        loginError: null,
        loginPending: false,
        ...userScopedResetSlice(),
      });
      clearUserScopedLocalStorage();
      return true;
    } catch (e) {
      set({
        loginError: `로그인 요청 실패: ${(e as Error).message}`,
        loginPending: false,
      });
      return false;
    }
  },
  logout: async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (e) {
      console.warn("[auth] logout request failed:", e);
    }
    // Clear all user-scoped state so the next login (potentially a
    // different account on the same browser) starts from an empty slate
    // instead of the previous user's data.
    set({
      auth: { status: "anonymous", user: null, authEnabled: true },
      loginError: null,
      ...userScopedResetSlice(),
    });
    clearUserScopedLocalStorage();
  },

  // ─── Prompt bundles ─────────────────────────────────────────────────────
  promptBundles: [],
  promptBundlesLoading: false,
  loadPromptBundles: async () => {
    set({ promptBundlesLoading: true });
    try {
      const res = await fetch("/api/prompt-bundles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      set({ promptBundles: Array.isArray(j?.bundles) ? j.bundles : [] });
    } catch (e) {
      get().showToast(`프롬프트 묶음 불러오기 실패: ${(e as Error).message}`, true);
    } finally {
      set({ promptBundlesLoading: false });
    }
  },
  savePromptBundle: async (name, opts = {}) => {
    const trimmed = name.trim();
    if (!trimmed) {
      get().showToast("이름을 입력하세요.", true);
      return null;
    }
    const promptText = get().prompt;
    if (!promptText.trim()) {
      get().showToast("저장할 프롬프트가 비어 있습니다.", true);
      return null;
    }
    try {
      const res = await fetch("/api/prompt-bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, prompt: promptText, tags: opts.tags ?? [] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const j = await res.json();
      const bundle = j.bundle as PromptBundle;
      set((s) => ({ promptBundles: [bundle, ...s.promptBundles] }));
      get().showToast(`프롬프트 묶음 "${bundle.name}" 저장됨.`);
      return bundle;
    } catch (e) {
      get().showToast(`저장 실패: ${(e as Error).message}`, true);
      return null;
    }
  },
  applyPromptBundle: (id) => {
    const bundle = get().promptBundles.find((b) => b.id === id);
    if (!bundle) {
      get().showToast("프롬프트 묶음을 찾을 수 없습니다.", true);
      return;
    }
    set({ prompt: bundle.prompt });
    get().showToast(`"${bundle.name}" 적용됨.`);
  },
  deletePromptBundle: async (id) => {
    try {
      const res = await fetch(`/api/prompt-bundles/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      set((s) => ({ promptBundles: s.promptBundles.filter((b) => b.id !== id) }));
      get().showToast("프롬프트 묶음을 삭제했습니다.");
    } catch (e) {
      get().showToast(`삭제 실패: ${(e as Error).message}`, true);
    }
  },
  updatePromptBundle: async (id, patch) => {
    try {
      const res = await fetch(`/api/prompt-bundles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const j = await res.json();
      const next = j.bundle as PromptBundle;
      set((s) => ({
        promptBundles: s.promptBundles.map((b) => (b.id === id ? next : b)),
      }));
    } catch (e) {
      get().showToast(`수정 실패: ${(e as Error).message}`, true);
    }
  },

  useCurrentAsReference: async () => {
    const cur = get().currentImage;
    if (!cur) {
      get().showToast("참조로 사용할 현재 이미지가 없습니다.", true);
      return;
    }
    if (get().referenceImages.length >= 5) {
      get().showToast("참조 이미지 슬롯이 가득 찼습니다. 최대 5장까지 가능합니다.", true);
      return;
    }
    let dataUrl = cur.image;
    if (!dataUrl.startsWith("data:")) {
      try {
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("read failed"));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(blob);
        });
      } catch {
        get().showToast("현재 이미지를 불러오지 못했습니다.", true);
        return;
      }
    }
    // gpt-image results commonly weigh 8-12MB raw PNG, which trips the
    // server's 7MB base64 cap. Down-scale to 1536px JPEG (≤6MB base64)
    // before pushing it into the reference slots.
    try {
      dataUrl = await resizeDataUrlForRef(dataUrl);
    } catch {
      // best-effort — server will surface a clear error if still too big
    }
    const hint = cur.filename
      ? ({ kind: "history" as const, filename: cur.filename })
      : ({ kind: "uploaded" as const });
    set((s) => ({
      referenceImages: [...s.referenceImages, dataUrl],
      referenceMetaHints: [...s.referenceMetaHints, hint],
    }));
    get().showToast("현재 이미지를 참조에 추가했습니다.");
  },
  // Start empty on every page load. The persisted localStorage inflight is
  // pulled in by `reconcileInflight()` (which runs once on mount) — that
  // reconciliation can mark each entry as still-running, finished (via
  // history rescue), or stuck/expired BEFORE we ever show a spinner. If we
  // seeded directly from localStorage here, a refresh would briefly flash
  // last session's "running" rows even though all of them long since
  // finished. activeGenerations starts at 0 for the same reason.
  activeGenerations: 0,
  inFlight: [],
  dismissActivity: (id) => {
    const next = get().inFlight.filter((f) => f.id !== id);
    saveInFlight(next);
    set({
      inFlight: next,
      activeGenerations: next.filter((f) => (f.status ?? "running") === "running").length,
    });
  },
  clearActivityHistory: () => {
    // Keeps in-progress entries; only clears terminal ones.
    const next = get().inFlight.filter((f) => (f.status ?? "running") === "running");
    saveInFlight(next);
    set({
      inFlight: next,
      activeGenerations: next.length,
    });
  },
  selectActivity: (id) => {
    const item = get().inFlight.find((f) => f.id === id);
    if (!item) return;
    if (item.status === "success" && item.filename) {
      const target = get().history.find((h) => h.filename === item.filename);
      if (target) {
        get().selectHistory(target);
        return;
      }
      // History not yet hydrated for this filename — fall back to constructing
      // a minimal item so the canvas can render the URL directly.
      get().selectHistory({
        image: `/generated/${item.filename}`,
        url: `/generated/${item.filename}`,
        filename: item.filename,
        prompt: item.prompt,
      });
      return;
    }
    if (item.clientNodeId && get().uiMode === "node") {
      // Node-mode click: leave focus to the existing node selection logic.
      // (Could pan/zoom to the node here in a future pass.)
    }
  },
  cancelActivity: (id) => {
    const item = get().inFlight.find((f) => f.id === id);
    if (!item || (item.status ?? "running") !== "running") return;
    void cancelInflight(id);
    const next = get().inFlight.map((f) =>
      f.id === id
        ? {
            ...f,
            status: "error" as const,
            endedAt: Date.now(),
            elapsedMs: Date.now() - f.startedAt,
            errorMessage: "취소됨",
            phase: undefined,
          }
        : f,
    );
    saveInFlight(next);
    set({
      inFlight: next,
      activeGenerations: next.filter((f) => (f.status ?? "running") === "running").length,
    });
  },
  retryActivity: async (id) => {
    const item = get().inFlight.find((f) => f.id === id);
    if (!item || !item.retry) {
      get().showToast("재시도 정보가 없습니다", true);
      return;
    }
    // Drop the failed entry first so a new one (with fresh id) replaces it.
    get().dismissActivity(id);
    if (item.retry.kind === "node" && item.retry.clientNodeId) {
      await get().generateNode(item.retry.clientNodeId);
    } else {
      const c = (item.retry.count === 2 || item.retry.count === 4 ? item.retry.count : 1) as Count;
      await get().generate({
        overridePrompt: item.retry.prompt,
        overrideCount: c,
      });
    }
  },
  startInFlightPolling: () => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __ima2InflightTimer?: number };
    if (w.__ima2InflightTimer) return;
    dlog("inflight", "startInFlightPolling");
    const tick = async () => {
      const cur = get().inFlight;
      const running = cur.filter((f) => (f.status ?? "running") === "running");
      if (running.length === 0) {
        if (w.__ima2InflightTimer) {
          clearInterval(w.__ima2InflightTimer);
          w.__ima2InflightTimer = undefined;
          dlog("inflight", "polling stopped (no running)");
        }
        return;
      }
      // Merge server-side phase + attempt info onto running entries.
      try {
        const inflightKind = get().uiMode === "node" ? "node" : "classic";
        const inflightSessionId =
          inflightKind === "node" ? get().activeSessionId ?? undefined : undefined;
        const { jobs } = await getInflight({
          kind: inflightKind,
          sessionId: inflightSessionId,
        });
        const byId = new Map(jobs.map((j) => [j.requestId, j] as const));
        let changed = false;
        const nextInflight = get().inFlight.map((f) => {
          // Only update entries still running locally.
          if ((f.status ?? "running") !== "running") return f;
          const j = byId.get(f.id);
          if (!j) return f;
          const newPhase = typeof j.phase === "string" ? j.phase : f.phase;
          const newAttempt = typeof j.attempt === "number" ? j.attempt : f.attempt;
          const newMax = typeof j.maxAttempts === "number" ? j.maxAttempts : f.maxAttempts;
          // Restore recovery metadata from server in case localStorage was
          // wiped or this entry came in via cross-tab `storage` sync without
          // its meta block.
          const meta = extractInflightMeta(j);
          const newKind = meta.kind ?? f.kind;
          const newSessionId = meta.sessionId ?? f.sessionId ?? null;
          const newParentNodeId = meta.parentNodeId ?? f.parentNodeId ?? null;
          const newClientNodeId = meta.clientNodeId ?? f.clientNodeId;
          if (
            newPhase === f.phase &&
            newAttempt === f.attempt &&
            newMax === f.maxAttempts &&
            newKind === f.kind &&
            newSessionId === (f.sessionId ?? null) &&
            newParentNodeId === (f.parentNodeId ?? null) &&
            newClientNodeId === f.clientNodeId
          ) {
            return f;
          }
          changed = true;
          return {
            ...f,
            phase: newPhase,
            attempt: newAttempt,
            maxAttempts: newMax,
            kind: newKind,
            sessionId: newSessionId,
            parentNodeId: newParentNodeId,
            clientNodeId: newClientNodeId,
          };
        });
        if (changed) {
          saveInFlight(nextInflight);
          set({
            inFlight: nextInflight,
            activeGenerations: nextInflight.filter((f) => (f.status ?? "running") === "running").length,
          });
        }
      } catch {}
      // Step 4-B: every poll cycle, sweep pending node-mode nodes whose
      // streaming response was lost. reconcileGraphPending now does a result-
      // store probe + sidecar fallback so this catches losses within ~5s
      // instead of waiting for the user to reload or the 60s setInterval.
      try {
        if (get().uiMode === "node") void get().reconcileGraphPending();
      } catch {}
      try {
        const lastKnown = get().history.reduce(
          (max, it) => (it.createdAt && it.createdAt > max ? it.createdAt : max),
          0,
        );
        const { items } = await getHistory({ limit: HISTORY_LIMIT, since: lastKnown });
        const arr: GenerateItem[] = items.map((it) => ({
          image: it.url,
          url: it.url,
          filename: it.filename,
          thumb: it.url,
          prompt: it.prompt ?? undefined,
          originalPrompt: it.originalPrompt ?? undefined,
          size: it.size ?? undefined,
          quality: it.quality ?? undefined,
          format: it.format as Format | undefined,
          createdAt: it.createdAt,
          sessionId: it.sessionId ?? null,
          favorite: it.favorite === true,
          ...(it.references && it.references.length > 0
            ? { references: it.references }
            : {}),
        }));
        const existing = get().history;
        const fresh = arr.filter(
          (a) => !existing.some((e) => e.filename === a.filename),
        );
        if (fresh.length > 0) {
          dlog("inflight", "polling history fresh:", fresh.length);
          set((s) => {
            const nextCurrent = s.currentImage ?? fresh[0];
            if (!s.currentImage && fresh[0]?.filename) {
              saveSelectedFilename(fresh[0].filename);
            }
            return {
              history: [...fresh, ...s.history].slice(0, HISTORY_LIMIT),
              currentImage: nextCurrent,
            };
          });
        }
        // Reconcile running inflight against fresh history rows by requestId.
        // A running entry whose requestId matches a new history row is the
        // success case after a refresh-during-fetch: server finished and
        // wrote the sidecar, but the client never got the response back.
        if (items.length > 0) {
          reconcileWithHistoryItems(items, get, set);
        }
        // TTL prune: drop expired terminal entries + reap stuck running entries.
        const now = Date.now();
        const remaining = get().inFlight.filter((f) => !isExpired(f, now));
        if (remaining.length !== get().inFlight.length) {
          dlog("inflight", "TTL prune:", get().inFlight.length - remaining.length);
          saveInFlight(remaining);
          set({
            inFlight: remaining,
            activeGenerations: remaining.filter((f) => (f.status ?? "running") === "running").length,
          });
        }
      } catch (err) {
        dwarn("inflight", "polling tick failed:", err);
      }
    };
    w.__ima2InflightTimer = window.setInterval(tick, 1500) as unknown as number;
  },
  reconcileInflight: async () => {
    try {
      const inflightKind = get().uiMode === "node" ? "node" : "classic";
      const inflightSessionId =
        inflightKind === "node" ? get().activeSessionId ?? undefined : undefined;
      // Fetch server inflight AND a recent history slice in parallel so we
      // can rescue running entries that completed while the client was gone.
      const [{ jobs }, historyPage] = await Promise.all([
        getInflight({ kind: inflightKind, sessionId: inflightSessionId }),
        getHistory({ limit: 100 }).catch(() => ({ items: [] as HistoryItem[], total: 0, nextCursor: null })),
      ]);
      const historyItems = historyPage.items || [];
      const serverById = new Map(jobs.map((j) => [j.requestId, j] as const));
      const historyByRequestId = new Map<string, HistoryItem>();
      for (const it of historyItems) {
        if (typeof it.requestId === "string" && it.requestId) {
          historyByRequestId.set(it.requestId, it);
        }
      }
      const now = Date.now();
      // First reconcile after page load: store starts with `inFlight: []`
      // (see initial state above) so a refresh doesn't flash last session's
      // stale spinners. Pull the persisted entries IN HERE so they get
      // immediately reconciled against server/history below — anything not
      // still running gets dropped or rescued before we ever set state.
      const currentLocal = get().inFlight;
      const local = currentLocal.length > 0 ? currentLocal : loadInFlight();
      let rescued = 0;
      let dropped = 0;
      let kept = 0;
      const merged: PersistedInFlight[] = [];
      for (const f of local) {
        const status = f.status ?? "running";
        if (status === "success") {
          if (!isExpired(f, now)) merged.push(f);
          continue;
        }
        // 1) Server still owns it → keep (running only; an "error" row
        //    appearing in serverIds is a stale local mistake). Restore
        //    recovery meta (kind/sessionId/parentNodeId/clientNodeId) from
        //    the server so a refreshed tab can rebuild node parent links.
        const serverJob = serverById.get(f.id);
        if (status === "running" && serverJob) {
          const meta = extractInflightMeta(serverJob);
          merged.push({
            ...f,
            kind: meta.kind ?? f.kind,
            sessionId: meta.sessionId ?? f.sessionId ?? null,
            parentNodeId: meta.parentNodeId ?? f.parentNodeId ?? null,
            clientNodeId: meta.clientNodeId ?? f.clientNodeId,
          });
          kept++;
          continue;
        }
        // 2) History has a row with our requestId → server finished and
        //    wrote the sidecar. Promote regardless of current local status,
        //    because the local "error" mark may come from a fetch torn down
        //    by refresh before the unloading guard fired.
        const histMatch = historyByRequestId.get(f.id);
        if (histMatch) {
          const successItem: PersistedInFlight = {
            ...f,
            status: "success",
            endedAt: histMatch.createdAt || now,
            elapsedMs: (histMatch.createdAt || now) - f.startedAt,
            filename: histMatch.filename,
            errorMessage: undefined,
            phase: undefined,
          };
          merged.push(successItem);
          rescued++;
          continue;
        }
        // Error rows that did NOT match history stay as-is until TTL.
        if (status === "error") {
          if (!isExpired(f, now)) merged.push(f);
          continue;
        }
        // 3) Neither in server nor history. The legacy rule dropped after
        //    10 s, but a slow generate (high quality / 4-up) routinely
        //    takes longer. Hold the entry for the full TTL (180 s) so the
        //    next polling tick still has a chance to find the sidecar.
        if (now - f.startedAt < INFLIGHT_TTL_MS) {
          merged.push(f);
          kept++;
          continue;
        }
        // 4) Truly stuck — convert to error so the user sees a retry button
        //    instead of the entry silently vanishing.
        merged.push({
          ...f,
          status: "error",
          endedAt: now,
          elapsedMs: now - f.startedAt,
          errorMessage: f.errorMessage || "결과를 확인할 수 없습니다 (타임아웃)",
          phase: undefined,
        });
        dropped++;
      }
      const localIds = new Set(merged.map((f) => f.id));
      for (const j of jobs) {
        if (!localIds.has(j.requestId)) {
          // Server-only entry — started in another tab/process or after our
          // localStorage was cleared. Populate full recovery meta so node
          // parent links survive the next refresh.
          const meta = extractInflightMeta(j);
          merged.push({
            id: j.requestId,
            prompt: j.prompt || "",
            startedAt: j.startedAt,
            status: "running",
            attempt: j.attempt,
            maxAttempts: j.maxAttempts,
            kind: meta.kind,
            sessionId: meta.sessionId,
            parentNodeId: meta.parentNodeId,
            clientNodeId: meta.clientNodeId,
          });
        }
      }
      // Hydrate history with the slice we just read so subsequent polling
      // ticks have a recent baseline (avoids first-tick refetch race).
      if (historyItems.length > 0) {
        const fresh: GenerateItem[] = historyItems.map((it) => ({
          image: it.url,
          url: it.url,
          filename: it.filename,
          thumb: it.url,
          prompt: it.prompt ?? undefined,
          originalPrompt: it.originalPrompt ?? undefined,
          size: it.size ?? undefined,
          quality: it.quality ?? undefined,
          format: it.format as Format | undefined,
          createdAt: it.createdAt,
          sessionId: it.sessionId ?? null,
          favorite: it.favorite === true,
          ...(it.references && it.references.length > 0
            ? { references: it.references }
            : {}),
        }));
        const existing = get().history;
        const newOnes = fresh.filter((a) => !existing.some((e) => e.filename === a.filename));
        if (newOnes.length > 0) {
          set((s) => ({
            history: [...newOnes, ...s.history].slice(0, HISTORY_LIMIT),
          }));
        }
      }
      dlog("inflight", "reconcile:", {
        serverJobs: jobs.length,
        localBefore: local.length,
        rescued,
        dropped,
        kept,
        historyMatched: historyByRequestId.size,
      });
      saveInFlight(merged);
      set({
        inFlight: merged,
        activeGenerations: merged.filter((f) => (f.status ?? "running") === "running").length,
      });
      if (merged.some((f) => (f.status ?? "running") === "running")) {
        get().startInFlightPolling();
      }
    } catch (err) {
      dwarn("inflight", "reconcile failed:", err);
    }
  },
  syncFromStorage: () => {
    // Triggered by `storage` events (another tab changed localStorage).
    const nextInflight = loadInFlight();
    const nextSelected = loadSelectedFilename();
    set((s) => ({
      inFlight: nextInflight,
      activeGenerations: nextInflight.filter((f) => (f.status ?? "running") === "running").length,
      currentImage:
        nextSelected && s.currentImage?.filename !== nextSelected
          ? s.history.find((h) => h.filename === nextSelected) ?? s.currentImage
          : s.currentImage,
    }));
    if (nextInflight.some((f) => (f.status ?? "running") === "running")) {
      get().startInFlightPolling();
    }
  },
  currentImage: null,
  history: [],
  toast: null,
  rightPanelOpen: loadRightPanelOpen(),
  toggleRightPanel: () =>
    set((s) => {
      const next = !s.rightPanelOpen;
      try {
        localStorage.setItem("ima2.rightPanelOpen", JSON.stringify(next));
      } catch {}
      return { rightPanelOpen: next };
    }),
  galleryOpen: false,
  galleryFavOnly: false,
  openGallery: (opts) => set({ galleryOpen: true, galleryFavOnly: opts?.favOnly === true }),
  closeGallery: () => set({ galleryOpen: false }),
  setGalleryFavOnly: (v) => set({ galleryFavOnly: v }),
  lightboxOpen: false,
  openLightbox: (filename) => {
    if (filename) {
      const target = get().history.find((h) => h.filename === filename);
      if (target) get().selectHistory(target);
    }
    if (!get().currentImage) return;
    const wasOpen = get().lightboxOpen;
    set({ lightboxOpen: true });
    const cur = get().currentImage;
    if (cur?.filename) {
      // First open → push history entry so back button closes the modal.
      // Subsequent opens (filename change while open) → replace.
      syncImageToUrl(cur.filename, wasOpen);
    }
  },
  closeLightbox: () => {
    set({ lightboxOpen: false });
    syncImageToUrl(null, false);
  },
  lightboxNext: () => {
    const cur = get().currentImage;
    const hist = get().history;
    if (!cur || hist.length === 0) return;
    const idx = hist.findIndex(
      (h) => (cur.filename && h.filename === cur.filename) || h.image === cur.image,
    );
    const nextIdx = idx < 0 ? 0 : Math.min(idx + 1, hist.length - 1);
    if (nextIdx === idx) return;
    get().selectHistory(hist[nextIdx]);
    const next = get().currentImage;
    if (next?.filename) syncImageToUrl(next.filename, true);
  },
  lightboxPrev: () => {
    const cur = get().currentImage;
    const hist = get().history;
    if (!cur || hist.length === 0) return;
    const idx = hist.findIndex(
      (h) => (cur.filename && h.filename === cur.filename) || h.image === cur.image,
    );
    const prevIdx = idx < 0 ? 0 : Math.max(idx - 1, 0);
    if (prevIdx === idx) return;
    get().selectHistory(hist[prevIdx]);
    const prev = get().currentImage;
    if (prev?.filename) syncImageToUrl(prev.filename, true);
  },
  jumpToImageSession: async (item) => {
    const target = item ?? get().currentImage;
    if (!target) return;
    // Close the overlay immediately so the click feels responsive even when
    // we have to fall back to /api/history to resolve the sessionId.
    if (get().lightboxOpen) set({ lightboxOpen: false });
    let sid = target.sessionId ?? null;
    if (!sid && target.filename) {
      try {
        const { items } = await getHistory({ limit: 500 });
        const hit = items.find((h) => h.filename === target.filename);
        sid = hit?.sessionId ?? null;
      } catch {}
    }
    if (!sid) {
      // Classic-mode image — no graph session to jump to. Prefill the
      // composer with this image's prompt + options so the click feels
      // like "open this for re-work" instead of a dead end.
      // upstream abfb80d 흡수: prompt 없는 이미지(외부 import 등)도 dead-end
      // 띄우지 말고 이미지를 ref로 첨부해서 "빈 prompt + ref" 상태로 진입.
      const prompt = (target.prompt ?? "").trim();
      const hasPrompt = prompt.length > 0;
      const s = get();
      const next: Partial<AppState> = {
        quality: (target.quality as Quality) || s.quality,
        sizePreset: (target.size as SizePreset) || s.sizePreset,
        moderation: (target.moderation as Moderation) || s.moderation,
      };
      if (hasPrompt) {
        next.prompt = prompt;
        next.originalPrompt =
          typeof target.originalPrompt === "string" && target.originalPrompt.length > 0
            ? target.originalPrompt
            : null;
      }
      set(next);
      if (!hasPrompt && target.image) {
        try {
          await get().addReferenceDataUrl(target.image);
        } catch {
          // ref 첨부 실패는 무시 — 빈 composer라도 열리게
        }
      }
      get().showToast(
        hasPrompt
          ? "프롬프트와 옵션을 가져왔습니다."
          : "이미지를 참조로 첨부했어요. 프롬프트 입력 후 생성하세요.",
      );
      // Focus the composer textarea after the lightbox unmounts.
      setTimeout(() => {
        const el = document.querySelector<HTMLTextAreaElement>(
          ".composer__textarea, .prompt-area",
        );
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 50);
      return;
    }
    if (get().uiMode !== "node") get().setUIMode("node");
    if (get().activeSessionId !== sid) {
      try {
        await get().switchSession(sid);
      } catch (err) {
        console.warn("[ima2:lightbox] switchSession failed", err);
        get().showToast("세션으로 이동하지 못했습니다.", true);
      }
    }
  },

  uiMode: loadUIMode(),
  setUIMode: (m) => {
    try { localStorage.setItem("ima2.uiMode", m); } catch {}
    set({ uiMode: m });
  },

  pendingFocusNodeId: null,
  setPendingFocusNodeId: (id) => set({ pendingFocusNodeId: id }),

  graphNodes: [],
  graphEdges: [],
  setGraphNodes: (graphNodes) => {
    set({ graphNodes });
    get().scheduleGraphSave();
  },
  setGraphEdges: (graphEdges) => {
    set({ graphEdges });
    get().scheduleGraphSave();
  },
  disconnectEdges: (ids) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    const next = get().graphEdges.filter((e) => !idSet.has(e.id));
    if (next.length === get().graphEdges.length) return;
    set({ graphEdges: next });
    get().scheduleGraphSave();
    get().showToast("연결선을 끊었습니다.");
  },
  autoLayoutGraph: (direction = "LR") => {
    const { graphNodes, graphEdges } = get();
    if (graphNodes.length === 0) return;
    const next = layoutGraph(graphNodes, graphEdges, direction);
    set({ graphNodes: next });
    get().scheduleGraphSave();
  },
  toggleNodeCollapsed: (clientId) => {
    const next = get().graphNodes.map((n) =>
      n.id === clientId
        ? { ...n, data: { ...n.data, collapsed: n.data.collapsed !== true } }
        : n,
    );
    set({ graphNodes: next });
    get().scheduleGraphSave();
  },
  setNodeColorTag: (clientId, tag) => {
    const next = get().graphNodes.map((n) =>
      n.id === clientId
        ? { ...n, data: { ...n.data, colorTag: tag ?? undefined } }
        : n,
    );
    set({ graphNodes: next });
    get().scheduleGraphSave();
  },

  nodeFilterText: "",
  nodeFilterStatuses: [],
  setNodeFilterText: (nodeFilterText) => set({ nodeFilterText }),
  toggleNodeFilterStatus: (status) => {
    const cur = get().nodeFilterStatuses;
    const next = cur.includes(status)
      ? cur.filter((s) => s !== status)
      : [...cur, status];
    set({ nodeFilterStatuses: next });
  },
  clearNodeFilters: () => set({ nodeFilterText: "", nodeFilterStatuses: [] }),

  trashedItems: typeof window === "undefined" ? [] : loadTrash(),
  trashOpen: false,
  setTrashOpen: (trashOpen) => set({ trashOpen }),
  restoreFromTrash: (trashId) => {
    const item = get().trashedItems.find((it) => it.id === trashId);
    if (!item) return;

    // Re-id collisions: if a node id in the trash already exists in the
    // current graph (rare but possible after import/export), drop the dup.
    // Keeping the simpler "skip on collision" path so we never overwrite a
    // live node that the user might still depend on.
    const existingIds = new Set(get().graphNodes.map((n) => n.id));
    const restorableNodes = item.nodes.filter((n) => !existingIds.has(n.id));
    const restorableNodeIds = new Set(restorableNodes.map((n) => n.id));
    const restorableEdges = item.edges.filter((e) => {
      const sourceOk = existingIds.has(e.source) || restorableNodeIds.has(e.source);
      const targetOk = restorableNodeIds.has(e.target);
      // Edge must point to a restored node — otherwise it's dangling. Source
      // can be either a still-live parent or another restored node.
      return sourceOk && targetOk;
    });

    if (restorableNodes.length === 0) {
      get().showToast("이미 같은 ID의 노드가 그래프에 있어 복구할 수 없습니다.", true);
      return;
    }

    const nextTrash = get().trashedItems.filter((it) => it.id !== trashId);
    saveTrash(nextTrash);

    set({
      graphNodes: [...get().graphNodes, ...restorableNodes],
      graphEdges: [...get().graphEdges, ...restorableEdges],
      trashedItems: nextTrash,
    });
    get().scheduleGraphSave();
    get().showToast(`${restorableNodes.length}개 노드를 복구했습니다.`);
  },
  purgeTrashItem: (trashId) => {
    const next = get().trashedItems.filter((it) => it.id !== trashId);
    saveTrash(next);
    set({ trashedItems: next });
  },
  emptyTrash: () => {
    saveTrash([]);
    set({ trashedItems: [] });
  },

  sessions: [],
  activeSessionId: null,
  activeSessionGraphVersion: null,
  sessionLoading: false,

  async loadSessions() {
    try {
      const { sessions } = await apiListSessions();
      set({ sessions });
      const current = get().activeSessionId;
      if (!current && sessions.length > 0) {
        await get().switchSession(sessions[0].id);
      } else if (!current && sessions.length === 0) {
        await get().createAndSwitchSession("첫 번째 그래프");
      }
    } catch (err) {
      console.warn("[sessions] load failed:", err);
    }
  },

  async switchSession(id) {
    set({ sessionLoading: true });
    await get().flushGraphSave("switch-session");
    try {
      const { session } = await apiGetSession(id);
      const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
      set({
        activeSessionId: id,
        activeSessionGraphVersion: graphVersion,
        graphNodes,
        graphEdges,
        sessionLoading: false,
      });
      void get().reconcileGraphPending();
      void get().reconcileOrphansFromDisk();
    } catch (err) {
      console.warn("[sessions] switch failed:", err);
      set({ sessionLoading: false });
      get().showToast("세션을 불러오지 못했습니다.", true);
    }
  },

  async reconcileGraphPending() {
    const sid = get().activeSessionId;
    if (!sid) return;
    const pendingNodes = get().graphNodes.filter(
      (n) => n.data?.pendingRequestId && (n.data.status === "pending" || n.data.status === "reconciling"),
    );
    if (pendingNodes.length === 0) return;
    let jobs: Array<{ requestId: string; phase?: string }> = [];
    try {
      const res = await getInflight({ kind: "node", sessionId: sid });
      jobs = res.jobs;
    } catch {
      return;
    }
    const byId = new Map(jobs.map((j) => [j.requestId, j.phase] as const));

    // Step 4-B: nodes that disappeared from inflight may have a cached result
    // ready (server completed but stream was lost). Fetch results in parallel
    // before falling back to stale.
    const missingFromInflight = pendingNodes.filter((n) => {
      const reqId = n.data?.pendingRequestId;
      return reqId ? !byId.has(reqId) : false;
    });
    const resultsByReqId = new Map<string, Awaited<ReturnType<typeof getNodeResult>>>();
    if (missingFromInflight.length > 0) {
      const probes = await Promise.allSettled(
        missingFromInflight.map(async (n) => {
          const reqId = n.data!.pendingRequestId!;
          const r = await getNodeResult(reqId);
          return [reqId, r] as const;
        }),
      );
      for (const p of probes) {
        if (p.status === "fulfilled") {
          const [reqId, result] = p.value;
          if (result) resultsByReqId.set(reqId, result);
        }
      }
    }

    let recoveredCount = 0;
    let failedCount = 0;
    const next = get().graphNodes.map((n) => {
      const reqId = n.data?.pendingRequestId;
      if (!reqId) return n;
      if (n.data.status !== "pending" && n.data.status !== "reconciling") return n;
      if (byId.has(reqId)) {
        const phase = byId.get(reqId) ?? null;
        return {
          ...n,
          data: { ...n.data, status: "reconciling" as const, pendingPhase: phase },
        };
      }
      // Not in-flight anymore — try result store first (Step 4-B), then fall
      // back to existing imageUrl check, then stale.
      const cached = resultsByReqId.get(reqId);
      if (cached && cached.status === "done") {
        recoveredCount++;
        return {
          ...n,
          data: {
            ...n.data,
            serverNodeId: cached.payload.nodeId,
            imageUrl: cached.payload.url,
            status: "ready" as const,
            pendingRequestId: null,
            pendingPhase: null,
            partialImageUrl: null,
            elapsed: cached.payload.elapsed,
            size: cached.payload.size ?? n.data.size ?? null,
            error: undefined,
          },
        };
      }
      if (cached && cached.status === "error") {
        failedCount++;
        return {
          ...n,
          data: {
            ...n.data,
            pendingRequestId: null,
            pendingPhase: null,
            partialImageUrl: null,
            status: "stale" as const,
            error: cached.error.message ?? "생성에 실패했습니다.",
          },
        };
      }
      const hasAsset = !!n.data.imageUrl || !!n.data.serverNodeId;
      return {
        ...n,
        data: {
          ...n.data,
          pendingRequestId: null,
          pendingPhase: null,
          status: hasAsset ? ("ready" as const) : ("stale" as const),
          error: hasAsset ? undefined : "생성이 정상적으로 끝나지 않았습니다. 이 노드에서 다시 시도하세요.",
        },
      };
    });
    set({ graphNodes: next });
    if (recoveredCount > 0 || failedCount > 0) {
      // Mirror reconcileOrphansFromDisk's UX so the user knows what just happened.
      const parts: string[] = [];
      if (recoveredCount > 0) parts.push(`이미지 ${recoveredCount}개 회복`);
      if (failedCount > 0) parts.push(`실패 ${failedCount}개 표시`);
      get().showToast(`끊긴 노드 자동 복구: ${parts.join(", ")}`);
      // The recovered/failed nodes are now diverged from the saved graph;
      // persist them so reload picks up the recovery.
      get().scheduleGraphSave();
    }
  },

  async reconcileOrphansFromDisk() {
    // Recover orphan node-mode generations whose stream response was lost
    // (long /api/node/generate dropped before client received "done" —
    // file lands on disk but the graph node never gets imageUrl). Server
    // scans sidecars and patches the DB; we refetch to pick up the
    // changes. Safe to call on every session load: server returns 0/0
    // when there is nothing to recover.
    const sid = get().activeSessionId;
    if (!sid) return;
    try {
      const orphan = await reconcileOrphans(sid);
      if (orphan.recovered === 0 && orphan.stalified === 0) return;
      const { session } = await apiGetSession(sid);
      const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
      set({
        graphNodes,
        graphEdges,
        activeSessionGraphVersion: graphVersion,
      });
      const parts: string[] = [];
      if (orphan.recovered > 0) parts.push(`이미지 ${orphan.recovered}개 회복`);
      if (orphan.stalified > 0) parts.push(`실패 ${orphan.stalified}개 표시`);
      get().showToast(`끊긴 노드 자동 복구: ${parts.join(", ")}`);
    } catch (err) {
      console.warn("[reconcile-orphans] failed:", err);
    }
  },

  async createAndSwitchSession(title = "제목 없는 세션") {
    try {
      const { session } = await apiCreateSession(title);
      set({
        sessions: [session as SessionSummary, ...get().sessions],
        activeSessionId: session.id,
        activeSessionGraphVersion: session.graphVersion,
        graphNodes: [],
        graphEdges: [],
      });
      // First-boot path also needs orphan reconcile — switchSession was
      // skipped, but a previous tab might have left pending generations
      // that completed server-side after the user closed the browser
      // (P1-9). reconcileGraphPending is a no-op when graphNodes is empty.
      void get().reconcileOrphansFromDisk();
    } catch (err) {
      console.warn("[sessions] create failed:", err);
      get().showToast("세션을 만들지 못했습니다.", true);
    }
  },

  async renameCurrentSession(title) {
    const id = get().activeSessionId;
    if (!id) return;
    try {
      await apiRenameSession(id, title);
      set({
        sessions: get().sessions.map((s) =>
          s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
        ),
      });
    } catch (err) {
      get().showToast("세션 이름을 바꾸지 못했습니다.", true);
    }
  },

  async deleteSessionById(id) {
    try {
      await apiDeleteSession(id);
      const remaining = get().sessions.filter((s) => s.id !== id);
      set({ sessions: remaining });
      if (get().activeSessionId === id) {
        set({
          activeSessionId: null,
          activeSessionGraphVersion: null,
          graphNodes: [],
          graphEdges: [],
        });
        if (remaining.length > 0) {
          await get().switchSession(remaining[0].id);
        } else {
          await get().createAndSwitchSession("첫 번째 그래프");
        }
      }
    } catch (err) {
      get().showToast("세션을 삭제하지 못했습니다.", true);
    }
  },

  scheduleGraphSave() {
    scheduleGraphSaveImpl(get, set);
  },

  async flushGraphSave(reason = "manual") {
    await flushGraphSaveImpl(get, set, reason);
  },

  addRootNode: () => {
    const clientId = newClientNodeId();
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: getNextRootPosition(get().graphNodes),
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: null,
        prompt: "",
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
      },
    };
    set({ graphNodes: [...get().graphNodes, node] });
    get().scheduleGraphSave();
    return clientId;
  },

  // Take a classic-mode (or any other history) image and adopt it as a fresh
  // root node so node-mode children can branch from it without an extra
  // generate. Switches the UI into node mode and ensures a session exists so
  // the imported node is persisted with the rest of the graph.
  async importHistoryAsRootNode(item) {
    const filename = item.filename;
    if (!filename) {
      get().showToast("이 이미지에는 파일명이 없어 노드로 보낼 수 없습니다.", true);
      return null;
    }
    if (get().uiMode !== "node") get().setUIMode("node");
    if (!get().activeSessionId) {
      await get().createAndSwitchSession("히스토리에서 가져옴");
    }
    const sessionId = get().activeSessionId;
    if (!sessionId) {
      get().showToast("세션이 없어 노드로 보낼 수 없습니다.", true);
      return null;
    }
    const clientId = newClientNodeId();
    const placeholder: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: getNextRootPosition(get().graphNodes),
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: null,
        prompt: item.prompt ?? "",
        imageUrl: item.url || item.image || null,
        status: "ready",
        pendingRequestId: null,
        pendingPhase: null,
        size: item.size ?? null,
      },
    };
    set({ graphNodes: [...get().graphNodes, placeholder] });
    try {
      const result = await postNodeImportHistory({
        historyFilename: filename,
        sessionId,
        clientNodeId: clientId,
      });
      set({
        graphNodes: get().graphNodes.map((n) =>
          n.id === clientId
            ? {
                ...n,
                data: {
                  ...n.data,
                  serverNodeId: result.nodeId,
                  imageUrl: result.url,
                  prompt: result.prompt || n.data.prompt,
                  size: result.size ?? n.data.size,
                  status: "ready",
                  pendingRequestId: null,
                  pendingPhase: null,
                },
              }
            : n,
        ),
      });
      get().scheduleGraphSave();
      get().showToast("노드 캔버스로 보냈습니다.");
      return clientId;
    } catch (err) {
      // P1-7: don't drop the placeholder — server may have written the image
      // + sidecar before the response failed. Keep it as stale so the next
      // reconcileOrphansFromDisk pass can match it via clientNodeId.
      set({
        graphNodes: get().graphNodes.map((n) =>
          n.id === clientId
            ? {
                ...n,
                data: {
                  ...n.data,
                  status: "stale",
                  error: "응답을 받지 못했습니다. 자동 복구를 시도합니다.",
                  pendingRequestId: null,
                  pendingPhase: null,
                },
              }
            : n,
        ),
      });
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      get().showToast(`노드로 보내지 못했습니다: ${msg} — 새로고침 또는 60초 내 자동 복구 시도`, true);
      // Immediate reconcile attempt — file may already be on disk.
      void get().reconcileOrphansFromDisk();
      return null;
    }
  },

  addChildNode: (parentClientId) => {
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return parentClientId;
    const clientId = newClientNodeId();
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: getNextChildPosition(parent, get().graphNodes, get().graphEdges),
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: parent.data.serverNodeId,
        prompt: "",
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
      },
    };
    const edge: GraphEdge = {
      id: `${parentClientId}->${clientId}`,
      source: parentClientId,
      target: clientId,
    };
    set({
      graphNodes: [...get().graphNodes, node],
      graphEdges: [...get().graphEdges, edge],
    });
    get().scheduleGraphSave();
    return clientId;
  },

  addSiblingNode: (sourceClientId) => {
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    if (!source) return sourceClientId;

    const incomingEdge = get().graphEdges.find((e) => e.target === sourceClientId);
    if (!incomingEdge) {
      const clientId = newClientNodeId();
      const node: GraphNode = {
        id: clientId,
        type: "imageNode",
        position: getNextRootPosition(get().graphNodes),
        data: {
          clientId,
          serverNodeId: null,
          parentServerNodeId: null,
          prompt: source.data.prompt,
          imageUrl: null,
          status: "empty",
          pendingRequestId: null,
          pendingPhase: null,
        },
      };
      set({ graphNodes: [...get().graphNodes, node] });
      get().scheduleGraphSave();
      return clientId;
    }

    const parentClientId = incomingEdge.source;
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return sourceClientId;

    const clientId = newClientNodeId();
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: getNextChildPosition(parent, get().graphNodes, get().graphEdges),
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: source.data.parentServerNodeId,
        prompt: source.data.prompt,
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
      },
    };
    const edge: GraphEdge = {
      id: `${parentClientId}->${clientId}`,
      source: parentClientId,
      target: clientId,
    };
    set({
      graphNodes: [...get().graphNodes, node],
      graphEdges: [...get().graphEdges, edge],
    });
    get().scheduleGraphSave();
    return clientId;
  },

  updateNodePrompt: (clientId, prompt) => {
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId ? { ...n, data: { ...n.data, prompt } } : n,
      ),
    });
    get().scheduleGraphSave();
  },

  addNodeReferences: async (clientId, files) => {
    const node = get().graphNodes.find((n) => n.id === clientId);
    if (!node) return;
    if (node.data.parentServerNodeId) {
      // Edit mode passes parent as the visual source — adding extra refs
      // here would be ambiguous (which one wins?). Block at the action.
      get().showToast("자식 노드는 부모 이미지를 자동 사용합니다 (참조 추가 불가).", true);
      return;
    }
    const currentRefs = node.data.referenceImages ?? [];
    const allowed = MAX_NODE_REFS - currentRefs.length;
    if (allowed <= 0) {
      get().showToast(`참조는 노드당 최대 ${MAX_NODE_REFS}개까지 가능합니다.`, true);
      return;
    }
    const toAdd = files.slice(0, allowed);
    const dataUrls = await Promise.all(
      toAdd.map(
        (f) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          }),
      ),
    );
    const valid = dataUrls.filter((x): x is string => !!x);
    if (valid.length === 0) return;
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId
          ? {
              ...n,
              data: {
                ...n.data,
                referenceImages: [...currentRefs, ...valid].slice(0, MAX_NODE_REFS),
              },
            }
          : n,
      ),
    });
    if (files.length > allowed) {
      get().showToast(`참조는 노드당 최대 ${MAX_NODE_REFS}개입니다 (초과분 제외).`, true);
    }
    get().scheduleGraphSave();
  },

  removeNodeReference: (clientId, index) => {
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId
          ? {
              ...n,
              data: {
                ...n.data,
                referenceImages: (n.data.referenceImages ?? []).filter((_, i) => i !== index),
              },
            }
          : n,
      ),
    });
    get().scheduleGraphSave();
  },

  clearNodeReferences: (clientId) => {
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId ? { ...n, data: { ...n.data, referenceImages: [] } } : n,
      ),
    });
    get().scheduleGraphSave();
  },

  duplicateBranchRoot: (sourceClientId) => {
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    if (!source) return sourceClientId;

    // Collect the source + all descendants via BFS over outgoing edges.
    const allEdges = get().graphEdges;
    const allNodes = get().graphNodes;
    const childrenBySource = new Map<string, string[]>();
    for (const e of allEdges) {
      const list = childrenBySource.get(e.source) ?? [];
      list.push(e.target);
      childrenBySource.set(e.source, list);
    }
    const idMap = new Map<string, string>();
    idMap.set(sourceClientId, newClientNodeId());
    const queue = [sourceClientId];
    for (let i = 0; i < queue.length; i++) {
      for (const child of childrenBySource.get(queue[i]) ?? []) {
        if (idMap.has(child)) continue;
        idMap.set(child, newClientNodeId());
        queue.push(child);
      }
    }

    const dx = 420;
    const dy = 40;
    const newNodes: GraphNode[] = [];
    for (const [oldId, newId] of idMap) {
      const oldNode = allNodes.find((n) => n.id === oldId);
      if (!oldNode) continue;
      const isCloneRoot = oldId === sourceClientId;
      // Clones start fresh — no serverNodeId, no imageUrl. Children reset
      // parentServerNodeId so each one will fetch its parent's new server
      // id at generation time. The clone root becomes a brand-new root.
      newNodes.push({
        id: newId,
        type: "imageNode",
        position: {
          x: oldNode.position.x + dx,
          y: oldNode.position.y + dy,
        },
        data: {
          clientId: newId as ClientNodeId,
          serverNodeId: null,
          parentServerNodeId: null,
          prompt: oldNode.data.prompt,
          imageUrl: null,
          status: "empty",
          pendingRequestId: null,
          pendingPhase: null,
          ...(isCloneRoot ? {} : { /* placeholder for non-root clones */ }),
        },
      });
    }

    const newEdges: GraphEdge[] = [];
    for (const edge of allEdges) {
      const newSource = idMap.get(edge.source);
      const newTarget = idMap.get(edge.target);
      if (!newSource || !newTarget) continue;
      newEdges.push({
        id: `${newSource}->${newTarget}`,
        source: newSource,
        target: newTarget,
      });
    }

    set({
      graphNodes: [...allNodes, ...newNodes],
      graphEdges: [...allEdges, ...newEdges],
    });
    get().scheduleGraphSave();

    const newRootId = idMap.get(sourceClientId)!;

    // Pre-seed the source image as a node-local reference on the new root
    // so the first generateNode() carries style/composition. Fire-and-forget
    // so the cloned subtree shows immediately; failures degrade to prompt-
    // only continuation. Uses the node-local ref slot (Phase 4.2 sub-PR 6)
    // rather than the session sidebar so cloning doesn't pollute global refs.
    if (source.data.imageUrl) {
      const sourceUrl = source.data.imageUrl;
      void (async () => {
        try {
          const resp = await fetch(sourceUrl);
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              typeof reader.result === "string"
                ? resolve(reader.result)
                : reject(new Error("read failed"));
            reader.onerror = () => reject(reader.error ?? new Error("read failed"));
            reader.readAsDataURL(blob);
          });
          const target = get().graphNodes.find((n) => n.id === newRootId);
          if (!target) return;
          const existing = target.data.referenceImages ?? [];
          if (existing.length >= MAX_NODE_REFS) return;
          set({
            graphNodes: get().graphNodes.map((n) =>
              n.id === newRootId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      referenceImages: [...existing, dataUrl].slice(0, MAX_NODE_REFS),
                    },
                  }
                : n,
            ),
          });
          get().scheduleGraphSave();
        } catch {
          // non-fatal
        }
      })();
    }

    return newRootId as ClientNodeId;
  },

  async generateNode(clientId) {
    // upstream 73f228e: 동시 호출 방지. lock 잡고 모든 early-return + finally 에서 해제.
    if (isNodeGenLocked(clientId)) {
      // 무반응처럼 느껴지는 silent return 가시화. lock TTL 경과 시 자동 해제됨.
      dwarn("node-gen", "lock held, skipping", clientId);
      get().showToast("이미 이 노드에서 생성이 진행 중입니다. 잠시 후 다시 시도하세요.", true);
      return;
    }
    nodeGenerationLocks.set(clientId, Date.now());
    // Capture session at start so a mid-generation switchSession does not leak
    // this node's save into the wrong session graph (P0-1).
    const startedSessionId = get().activeSessionId;
    // In-place regen: ready nodes used to spawn an orphan sibling (P1-8). Now
    // they always overwrite. Use addSiblingAndGenerate(clientId) for the
    // explicit "변형 1" button on ImageNode).
    const targetClientId = clientId;
    const node = get().graphNodes.find((n) => n.id === targetClientId);
    if (!node) {
      // Was a silent return — surfaces a toast + dwarn so the "click does
      // nothing, but inflight log shows queued" mismatch is diagnosable.
      dwarn("node-gen", "node not found in store", clientId, {
        graphNodeIds: get().graphNodes.map((n) => n.id),
      });
      get().showToast("노드를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.", true);
      nodeGenerationLocks.delete(clientId);
      return;
    }
    const { prompt, parentServerNodeId } = node.data;
    if (!prompt.trim()) {
      dwarn("node-gen", "empty prompt", clientId, { status: node.data.status });
      get().showToast("프롬프트가 비어있습니다. 노드를 클릭해 프롬프트를 입력하세요.", true);
      nodeGenerationLocks.delete(clientId);
      return;
    }
    dlog("node-gen", "start", {
      clientId,
      promptLen: prompt.length,
      parentServerNodeId,
      status: node.data.status,
      hasServerNodeId: !!node.data.serverNodeId,
    });
    const s = get();
    const size = s.getResolvedSize();

    // mark pending
    const flightId = `fn_${targetClientId}`;
    const startedAt = Date.now();
    const nextInFlight: PersistedInFlight[] = [
      ...s.inFlight,
      {
        id: flightId,
        prompt,
        startedAt,
        status: "running",
        attempt: 1,
        maxAttempts: s.maxAttempts,
        retry: { kind: "node", prompt, clientNodeId: targetClientId },
        kind: "node",
        sessionId: s.activeSessionId,
        parentNodeId: parentServerNodeId ?? null,
        clientNodeId: targetClientId,
      },
    ];
    saveInFlight(nextInFlight);
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === targetClientId
          ? {
              ...n,
              data: {
                ...n.data,
                status: "pending",
                pendingRequestId: flightId,
                pendingPhase: "queued",
                error: undefined,
                size,
                partialImageUrl: null,
              },
            }
          : n,
      ),
      activeGenerations: s.activeGenerations + 1,
      inFlight: nextInFlight,
    });
    get().startInFlightPolling();

    try {
      const res = await postNodeGenerateStream(
        {
          parentNodeId: parentServerNodeId,
          prompt,
          quality: s.quality,
          size,
          format: s.format,
          moderation: s.moderation,
          requestId: flightId,
          sessionId: s.activeSessionId,
          clientNodeId: targetClientId,
          maxAttempts: s.maxAttempts,
          ...(s.originalPrompt && s.originalPrompt !== prompt
            ? { originalPrompt: s.originalPrompt }
            : {}),
          // Node-local refs win over the session sidebar slot — they were
          // attached specifically to this node, so users expect them to be
          // used for regeneration even when the sidebar is empty/different.
          ...((node.data.referenceImages?.length ?? 0) > 0 && !parentServerNodeId
            ? {
                references: node.data.referenceImages!.map((d) =>
                  d.replace(/^data:[^;]+;base64,/, ""),
                ),
              }
            : s.referenceImages.length && !parentServerNodeId
              ? { references: s.referenceImages.map((d) => d.replace(/^data:[^;]+;base64,/, "")) }
              : {}),
        },
        {
          onPartial: (partial) => {
            set({
              graphNodes: get().graphNodes.map((n) =>
                n.id === targetClientId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "pending",
                        partialImageUrl: partial.image,
                        pendingPhase: "partial",
                      },
                    }
                  : n,
              ),
            });
          },
          onPhase: (phase) => {
            if (!phase.phase) return;
            set({
              graphNodes: get().graphNodes.map((n) =>
                n.id === targetClientId
                  ? {
                      ...n,
                      data: { ...n.data, pendingPhase: phase.phase ?? n.data.pendingPhase },
                    }
                  : n,
              ),
            });
          },
        },
      );
      set({
        graphNodes: get().graphNodes.map((n) =>
          n.id === targetClientId
            ? {
                ...n,
                data: {
                  ...n.data,
                  serverNodeId: res.nodeId,
                  imageUrl: res.url,
                  status: "ready",
                  pendingRequestId: null,
                  pendingPhase: null,
                  partialImageUrl: null,
                  elapsed: res.elapsed,
                  webSearchCalls: res.webSearchCalls,
                  size: res.size ?? n.data.size ?? size,
                },
              }
            : n,
        ),
      });
      get().showToast(`노드 ${res.nodeId.slice(0, 8)} 생성 완료 (${res.elapsed}초)`);
      // Mark activity success.
      const elapsedMs = Math.round(Number(res.elapsed) * 1000) || (Date.now() - startedAt);
      const next = get().inFlight.map((f) =>
        f.id === flightId
          ? {
              ...f,
              status: "success" as const,
              endedAt: Date.now(),
              elapsedMs,
              phase: undefined,
              clientNodeId: targetClientId,
            }
          : f,
      );
      saveInFlight(next);
      set({
        inFlight: next,
        activeGenerations: Math.max(0, get().activeGenerations - 1),
      });
    } catch (err) {
      // Same page-unload guard as classic generate: server keeps the request,
      // local state should not flip to "error" just because the tab tore down.
      if (unloading) return;

      // SSE 끊김/타임아웃이지만 서버는 디스크에 결과를 남겼을 수 있다 (사용자
      // 보고: "이미지 생성됐는데 노드에 안 뜨는 경우 많음"). 같은 reqId로
      // cached result 한 번 probe — done이면 ready로 마킹하고 정상 종료
      // path와 동일하게 처리. reconcileGraphPending이 이미 쓰는 패턴과 동일.
      try {
        const cached = await getNodeResult(flightId);
        if (cached && cached.status === "done") {
          set({
            graphNodes: get().graphNodes.map((n) =>
              n.id === targetClientId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      serverNodeId: cached.payload.nodeId,
                      imageUrl: cached.payload.url,
                      status: "ready",
                      pendingRequestId: null,
                      pendingPhase: null,
                      partialImageUrl: null,
                      elapsed: cached.payload.elapsed,
                      size: cached.payload.size ?? n.data.size ?? size,
                      error: undefined,
                    },
                  }
                : n,
            ),
          });
          get().showToast(
            `노드 ${cached.payload.nodeId.slice(0, 8)} 생성 완료 (스트림 끊김 후 복구)`,
          );
          const elapsedMs =
            Math.round(Number(cached.payload.elapsed) * 1000) || (Date.now() - startedAt);
          const next = get().inFlight.map((f) =>
            f.id === flightId
              ? {
                  ...f,
                  status: "success" as const,
                  endedAt: Date.now(),
                  elapsedMs,
                  phase: undefined,
                  clientNodeId: targetClientId,
                }
              : f,
          );
          saveInFlight(next);
          set({
            inFlight: next,
            activeGenerations: Math.max(0, get().activeGenerations - 1),
          });
          return;
        }
      } catch {
        // probe 실패는 무시하고 정상 error path 진행.
      }

      const msg = err instanceof Error ? err.message : "노드 생성에 실패했습니다.";
      set({
        graphNodes: get().graphNodes.map((n) =>
          n.id === targetClientId
            ? {
                ...n,
                data: {
                  ...n.data,
                  status: "error",
                  pendingRequestId: null,
                  pendingPhase: null,
                  partialImageUrl: null,
                  error: msg,
                },
              }
            : n,
        ),
      });
      get().showToast(msg, true);
      const next = get().inFlight.map((f) =>
        f.id === flightId
          ? {
              ...f,
              status: "error" as const,
              endedAt: Date.now(),
              elapsedMs: Date.now() - startedAt,
              errorMessage: msg,
              phase: undefined,
            }
          : f,
      );
      saveInFlight(next);
      set({
        inFlight: next,
        activeGenerations: Math.max(0, get().activeGenerations - 1),
      });
    } finally {
      nodeGenerationLocks.delete(targetClientId);
      if (!unloading) {
        if (get().activeSessionId === startedSessionId) {
          get().scheduleGraphSave();
        } else {
          // Session switched mid-generation. Image + sidecar are on disk;
          // reconcileOrphansFromDisk will recover the node when user returns
          // to the original session.
          console.warn("[node-generate] session switched mid-flight — relying on disk reconcile", { startedSessionId, currentSessionId: get().activeSessionId });
        }
      }
    }
  },

  async addSiblingAndGenerate(sourceClientId) {
    const sib = get().addSiblingNode(sourceClientId);
    if (sib === sourceClientId) return; // addSiblingNode short-circuited
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    if (source?.data.prompt) {
      get().updateNodePrompt(sib, source.data.prompt);
    }
    await get().generateNode(sib);
  },

  // C-option Lightbox cascade: when user wants Shift+Delete to also remove
  // the graph node card (not just leave an "asset-missing" placeholder),
  // find every graph node whose imageUrl resolves to this filename and trash
  // them via the existing deleteNodes action (which already handles undo
  // history + scheduleGraphSave). Returns the count for the caller's toast.
  // Caller MUST flushGraphSave before triggering the asset trash, otherwise
  // the server's markNodesAssetMissing pass may bump graph_version first and
  // a subsequent 409 reload will resurrect the deleted nodes as asset-missing.
  deleteNodesByFilename: (filename) => {
    const matching = get().graphNodes.filter((n) => {
      const url = n.data?.imageUrl;
      if (typeof url !== "string") return false;
      const last = url.split("/").pop();
      if (!last) return false;
      return last.split("?")[0] === filename;
    });
    if (matching.length === 0) return 0;
    get().deleteNodes(matching.map((n) => n.id));
    return matching.length;
  },

  async fanOutFromNode(parentClientId, count = 3) {
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return;
    const promptToUse = (parent.data.prompt ?? "").trim();
    if (!promptToUse) {
      get().showToast("부모 노드에 프롬프트가 없습니다.", true);
      return;
    }
    const safeCount = Math.max(1, Math.min(8, Math.floor(count)));
    const childIds: ClientNodeId[] = [];
    for (let i = 0; i < safeCount; i++) {
      const cid = get().addChildNode(parentClientId);
      get().updateNodePrompt(cid, promptToUse);
      childIds.push(cid);
    }
    // Schedule generates concurrently — server registers each via requestId
    // so partial failures don't abort the rest. We surface a single toast at
    // the end with success/failure counts.
    const results = await Promise.allSettled(
      childIds.map((id) => get().generateNode(id)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      get().showToast(`변형 ${safeCount}개 생성 시작.`);
    } else {
      get().showToast(
        `변형 ${safeCount - failed}/${safeCount}개만 시작됨 (${failed}개 실패).`,
        true,
      );
    }
  },

  deleteNode: (clientId) => {
    get().deleteNodes([clientId]);
  },

  deleteNodes: (clientIds) => {
    const ids = new Set(clientIds);
    const nodes = get().graphNodes;
    const edges = get().graphEdges;
    const removedNodes = nodes.filter((n) => ids.has(n.id));
    if (removedNodes.length === 0) return;
    const removedEdges = edges.filter((e) => ids.has(e.source) || ids.has(e.target));

    for (const n of removedNodes) {
      const reqId = n.data?.pendingRequestId;
      if (reqId) void cancelInflight(reqId);
    }

    const trashItem = makeTrashItem(removedNodes, removedEdges);
    const nextTrash = [trashItem, ...get().trashedItems];
    saveTrash(nextTrash);

    set({
      graphNodes: nodes.filter((n) => !ids.has(n.id)),
      graphEdges: edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      trashedItems: nextTrash,
    });
    get().scheduleGraphSave();
    get().showToast(
      `${removedNodes.length}개 노드를 휴지통으로 이동했습니다. (7일 보관)`,
    );
  },

  addChildNodeAt: (parentClientId, position) => {
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return parentClientId;
    const clientId = newClientNodeId();
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position,
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: parent.data.serverNodeId,
        prompt: "",
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
      },
    };
    const edge: GraphEdge = {
      id: `${parentClientId}->${clientId}`,
      source: parentClientId,
      target: clientId,
    };
    set({
      graphNodes: [...get().graphNodes, node],
      graphEdges: [...get().graphEdges, edge],
    });
    get().scheduleGraphSave();
    return clientId;
  },

  connectNodes: (sourceClientId, targetClientId) => {
    if (sourceClientId === targetClientId) return;
    const existing = get().graphEdges.find(
      (e) => e.source === sourceClientId && e.target === targetClientId,
    );
    if (existing) return;
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    if (!source) return;
    // Cycle guard: refuse if target can already reach source (P0-5). Without
    // this, A→B→C→A connections deadlock topologicalSort/layoutGraph and
    // freeze the tab.
    if (wouldCreateCycle(get().graphEdges, sourceClientId, targetClientId)) {
      get().showToast("순환 연결은 만들 수 없습니다.", true);
      return;
    }
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === targetClientId
          ? { ...n, data: { ...n.data, parentServerNodeId: source.data.serverNodeId } }
          : n,
      ),
      graphEdges: [
        ...get().graphEdges,
        { id: `${sourceClientId}->${targetClientId}`, source: sourceClientId, target: targetClientId },
      ],
    });
    get().scheduleGraphSave();
  },

  // ── Node batch selection ──
  nodeSelectionMode: false,
  nodeBatchRunning: false,
  nodeBatchStopping: false,
  toggleNodeSelectionMode: () => {
    const next = !get().nodeSelectionMode;
    set({
      nodeSelectionMode: next,
      // Clear residual selection when turning the mode off — selected
      // nodes would otherwise stay highlighted but inert.
      ...(next ? {} : { graphNodes: applySelectedNodeIds(get().graphNodes, []) }),
    });
  },
  selectAllGraphNodes: () => {
    set({
      graphNodes: applySelectedNodeIds(
        get().graphNodes,
        get().graphNodes.map((n) => n.id),
      ),
    });
  },
  selectNodeGraph: (clientId, additive) => {
    set({
      graphNodes: applyComponentSelection(
        get().graphNodes,
        get().graphEdges,
        clientId,
        additive,
      ),
    });
  },
  clearNodeSelection: () => {
    set({ graphNodes: applySelectedNodeIds(get().graphNodes, []) });
  },
  cancelNodeBatch: () => {
    if (!get().nodeBatchRunning) return;
    set({ nodeBatchStopping: true });
    get().showToast("배치 작업을 중지합니다 (현재 진행 중인 노드 완료 후).");
  },
  async runNodeBatch(mode) {
    if (get().nodeBatchRunning) return;
    const selectedIds = getSelectedNodeIds(get().graphNodes);
    if (selectedIds.length === 0) {
      get().showToast("선택된 노드가 없습니다.", true);
      return;
    }
    const blocked = validateBatchDependencies(get().graphNodes, get().graphEdges, selectedIds);
    if (blocked.length > 0) {
      get().showToast(
        `상위 노드가 아직 생성되지 않은 노드 ${blocked.length}개가 있어 실행할 수 없습니다.`,
        true,
      );
      return;
    }
    const orderedIds = topologicalSortSelected(get().graphNodes, get().graphEdges, selectedIds);
    const candidates = orderedIds.filter((id) => {
      if (mode === "regenerate-all") {
        // Phase 4.2 sub-PR 5 ships missing-only. In-place regenerate
        // requires a deeper refactor of generateNode (currently spawns a
        // sibling when status==='ready') — sub-PR 6 / 7 territory.
        const node = get().graphNodes.find((n) => n.id === id);
        return node ? !nodeHasImage(node) : false;
      }
      const node = get().graphNodes.find((n) => n.id === id);
      return node ? !nodeHasImage(node) : false;
    });
    if (candidates.length === 0) {
      get().showToast("실행할 노드가 없습니다 (모두 완료 상태).");
      return;
    }
    set({ nodeBatchRunning: true, nodeBatchStopping: false });
    let completed = 0;
    try {
      for (const clientId of candidates) {
        if (get().nodeBatchStopping) break;
        try {
          await get().generateNode(clientId as ClientNodeId);
          completed += 1;
        } catch (err) {
          console.warn("[node-batch] generation failed:", err);
          get().showToast(
            `${completed}/${candidates.length}개 완료 후 실패했습니다.`,
            true,
          );
          break;
        }
      }
      if (completed > 0) {
        get().showToast(`배치 완료: ${completed}/${candidates.length}개 생성됨`);
      }
      get().scheduleGraphSave();
    } finally {
      set({ nodeBatchRunning: false, nodeBatchStopping: false });
    }
  },

  setProvider: (provider) => set({ provider }),
  setQuality: (quality) => set({ quality }),
  setSizePreset: (sizePreset) => set({ sizePreset }),
  setCustomSize: (w, h) => set({ customW: snap16(w), customH: snap16(h) }),
  setFormat: (format) => set({ format }),
  setModeration: (moderation) => set({ moderation }),
  setCount: (count) => set({ count }),
  setPrompt: (prompt) => {
    // Direct edits invalidate the saved enhance source, unless the user is
    // restoring the exact enhanced text again (no-op).
    const cur = get();
    const next: Partial<AppState> = { prompt };
    if (cur.originalPrompt && prompt !== cur.prompt) next.originalPrompt = null;
    set(next);
  },
  restoreFromImageMetadata: (meta) => {
    const patch: Partial<AppState> = {};
    if (typeof meta.prompt === "string" && meta.prompt.length > 0) {
      patch.prompt = meta.prompt;
      patch.originalPrompt = null;
    }
    if (typeof meta.quality === "string" && (meta.quality === "low" || meta.quality === "medium" || meta.quality === "high")) {
      patch.quality = meta.quality;
    }
    if (typeof meta.size === "string" && /^\d+x\d+$/.test(meta.size)) {
      // Size string can match a known preset (use setSizePreset path) or be
      // arbitrary custom (write to customW/customH and switch to "custom").
      // We just store the literal — SizePicker reads sizePreset, so set both.
      const [wStr, hStr] = meta.size.split("x");
      const w = Number(wStr);
      const h = Number(hStr);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        patch.sizePreset = meta.size as AppState["sizePreset"];
        patch.customW = snap16(w);
        patch.customH = snap16(h);
      }
    } else if (meta.size === "auto") {
      patch.sizePreset = "auto" as AppState["sizePreset"];
    }
    // fork extension: moderation 복원
    if (typeof meta.moderation === "string" && (meta.moderation === "auto" || meta.moderation === "low")) {
      patch.moderation = meta.moderation;
    }
    // fork extension: originalPrompt — sexy-tune 등으로 enhanced 된 prompt 의
    // 원문 복원. patch.prompt 가 enhanced 본일 때 originalPrompt 도 같이 채움.
    if (meta.fork?.originalPrompt && typeof meta.fork.originalPrompt === "string") {
      patch.originalPrompt = meta.fork.originalPrompt;
    }
    // fork extension: maxAttempts 복원
    if (meta.fork?.maxAttempts) {
      const n = Number(meta.fork.maxAttempts);
      if (Number.isFinite(n) && n >= 1 && n <= 20) {
        patch.maxAttempts = n;
      }
    }
    // 주의: meta.fork.outfit 은 sexy-tune 모달 상태와 결합돼야 의미가 있어
    // 자동 복원 안 함 (MetadataRestoreCard 가 표시해서 사용자가 SexyTuneModal
    // 을 열어 재현하도록 안내). 자동 복원하려면 SexyTuneModal 의 store
    // 슬라이스에 "importOutfit(json)" 전용 액션이 필요 → 후속.
    if (Object.keys(patch).length > 0) set(patch);
  },
  originalPrompt: null,
  applyEnhancedPrompt: (original, enhanced) => {
    const trimmed = enhanced.trim();
    if (!trimmed) return;
    set({
      prompt: trimmed,
      originalPrompt: original.trim() || null,
    });
  },
  clearOriginalPrompt: () => set({ originalPrompt: null }),
  revertToOriginalPrompt: () => {
    const orig = get().originalPrompt;
    if (!orig) return;
    set({ prompt: orig, originalPrompt: null });
  },
  applyPreset: (payload: PresetPayload) => {
    set({
      quality: payload.quality,
      sizePreset: payload.sizePreset,
      format: payload.format,
      moderation: payload.moderation,
      count: payload.count,
      ...(payload.sizePreset === "custom" && payload.customW && payload.customH
        ? { customW: payload.customW, customH: payload.customH }
        : {}),
    });
  },

  selectHistory: (item) => {
    saveSelectedFilename(item.filename ?? null);
    set({ currentImage: item });

    // 갤러리에서 이미지를 골랐을 때 해당 출처 모드로 자동 전환 + (노드면)
    // 그 노드로 화면 이동을 예약. server.js loadHistoryRows가 sidecar의
    // clientNodeId/kind를 그대로 노출하므로 신뢰 가능.
    const fromNode =
      item.kind === "node" ||
      typeof item.clientNodeId === "string" && item.clientNodeId.length > 0;
    if (fromNode) {
      if (get().uiMode !== "node") get().setUIMode("node");
      const cid = item.clientNodeId as ClientNodeId | undefined;
      if (cid && get().graphNodes.some((n) => n.id === cid)) {
        set({ pendingFocusNodeId: cid });
      }
    } else if (item.kind === "generate" || item.kind === "edit") {
      // classic 출처 — 명시적으로 classic으로 돌려보낸다.
      if (get().uiMode !== "classic") get().setUIMode("classic");
    }
  },

  removeFromHistory: (filename) => {
    const s = get();
    const history = s.history.filter((h) => h.filename !== filename);
    const stillCurrent =
      s.currentImage && s.currentImage.filename === filename ? null : s.currentImage;
    set({ history, currentImage: stillCurrent });
    if (stillCurrent === null) saveSelectedFilename(null);
  },

  addHistoryItem: (item) => {
    const s = get();
    const exists = s.history.some(
      (h) => item.filename && h.filename === item.filename,
    );
    if (exists) return;
    const withDefaults: GenerateItem = {
      ...item,
      createdAt: item.createdAt || Date.now(),
    };
    set({ history: [withDefaults, ...s.history].slice(0, HISTORY_LIMIT) });
  },

  toggleFavorite: async (filename?: string) => {
    const s = get();
    const target = filename ?? s.currentImage?.filename;
    if (!target) return;
    const currentItem =
      s.history.find((h) => h.filename === target) ??
      (s.currentImage?.filename === target ? s.currentImage : null);
    const next = !currentItem?.favorite;

    const patchItem = <T extends { filename?: string; favorite?: boolean }>(it: T): T =>
      it.filename === target ? { ...it, favorite: next } : it;
    set({
      history: s.history.map(patchItem),
      currentImage: s.currentImage ? patchItem(s.currentImage) : s.currentImage,
    });

    try {
      await setFavorite(target, next);
    } catch (err) {
      const revert = <T extends { filename?: string; favorite?: boolean }>(it: T): T =>
        it.filename === target ? { ...it, favorite: !next } : it;
      set({
        history: get().history.map(revert),
        currentImage: get().currentImage ? revert(get().currentImage!) : get().currentImage,
      });
      s.showToast("즐겨찾기 저장 실패", true);
      console.error(err);
    }
  },

  getResolvedSize: () => {
    const { sizePreset, customW, customH } = get();
    return sizePreset === "custom" ? `${customW}x${customH}` : sizePreset;
  },

  async generate(overrides) {
    const s = get();
    const prompt = (overrides?.overridePrompt ?? s.prompt).trim();
    if (!prompt) return;
    // Refuse early when we already know we're rate-limited; otherwise every
    // click burns more upstream budget for the same 429.
    const cool = get().usageLimitedUntil;
    if (cool && cool > Date.now()) {
      const sec = Math.max(1, Math.ceil((cool - Date.now()) / 1000));
      get().showToast(
        `OpenAI 사용 한도에 도달했습니다. 약 ${sec}초 뒤 자동 해제됩니다.`,
        true,
      );
      return;
    }
    const count = overrides?.overrideCount ?? s.count;

    const size = overrides?.overrideSize ?? s.getResolvedSize();
    const quality = overrides?.overrideQuality ?? s.quality;
    // Reference snapshot (overrideReferences) lets sexy-tune lock the refs
    // at batch start so the user can close the modal and queue another
    // batch with different refs without poisoning in-flight calls.
    const references = overrides?.overrideReferences
      ? overrides.overrideReferences
      : s.referenceImages.length
        ? s.referenceImages.map((d) => d.replace(/^data:[^;]+;base64,/, ""))
        : null;
    // Index-aligned lineage hints; trimmed to whatever references we send.
    const referenceMeta = overrides?.overrideReferences
      ? overrides.overrideReferences.map(() => ({ kind: "uploaded" as const }))
      : s.referenceImages.length
        ? s.referenceMetaHints
            .slice(0, s.referenceImages.length)
            .map((h) => h ?? { kind: "uploaded" as const })
        : null;

    const startedAt = Date.now();
    const flightIds = Array.from(
      { length: count },
      (_, i) => `f_${startedAt}_${i}_${Math.random().toString(36).slice(2, 7)}`,
    );
    const newEntries: PersistedInFlight[] = flightIds.map((id) => ({
      id,
      prompt,
      startedAt,
      status: "running" as const,
      attempt: 1,
      maxAttempts: s.maxAttempts,
      retry: { kind: "classic" as const, prompt, count: 1 },
      kind: "classic" as const,
      sessionId: s.activeSessionId,
      parentNodeId: null,
    }));
    set((state) => ({
      activeGenerations: state.activeGenerations + count,
      inFlight: [...state.inFlight, ...newEntries],
    }));
    saveInFlight(get().inFlight);
    get().startInFlightPolling();

    let succeeded = 0;
    let failed = 0;
    let maxElapsed = 0;
    let firstErrMsg: string | null = null;

    console.log(
      `[ima2][generate] start: flights=${flightIds.length} quality=${s.quality} ` +
      `size=${size} moderation=${s.moderation} maxAttempts=${s.maxAttempts} ` +
      `refs=${references?.length ?? 0} promptLen=${prompt.length} ` +
      `hasOriginal=${Boolean(s.originalPrompt && s.originalPrompt !== prompt)}`,
    );

    await Promise.all(
      flightIds.map(async (flightId) => {
        const slotStartedAt = Date.now();
        console.log(`[ima2][generate][${flightId}] posting /api/generate`);
        try {
          const res: GenerateResponse = await postGenerate({
            prompt,
            quality,
            size,
            format: s.format,
            moderation: s.moderation,
            provider: s.provider,
            n: 1,
            requestId: flightId,
            maxAttempts: s.maxAttempts,
            ...(s.originalPrompt && s.originalPrompt !== prompt
              ? { originalPrompt: s.originalPrompt }
              : {}),
            ...(references ? { references } : {}),
            ...(referenceMeta ? { referenceMeta } : {}),
            ...(overrides?.outfitModule ? { outfitModule: overrides.outfitModule } : {}),
            ...(overrides?.batchId
              ? {
                  batchId: overrides.batchId,
                  batchIndex: overrides.batchIndex ?? 0,
                  batchTotal: overrides.batchTotal,
                  batchSource: overrides.batchSource,
                }
              : {}),
          });
          console.log(
            `[ima2][generate][${flightId}] response ok in ` +
            `${Date.now() - slotStartedAt}ms elapsed=${(res as { elapsed?: number }).elapsed}`,
          );

          // Server returns single-shape for n=1, but handle multi defensively.
          const picked = isMultiResponse(res)
            ? {
                image: res.images[0]?.image ?? "",
                filename: res.images[0]?.filename,
                references: res.images[0]?.references,
              }
            : {
                image: res.image,
                filename: res.filename,
                references: (res as { references?: GenerateItem["references"] }).references,
              };
          if (!picked.image) throw new Error("빈 응답");

          const item: GenerateItem = {
            image: picked.image,
            filename: picked.filename,
            prompt,
            ...(s.originalPrompt && s.originalPrompt !== prompt
              ? { originalPrompt: s.originalPrompt }
              : {}),
            elapsed: res.elapsed,
            provider: res.provider,
            usage: res.usage,
            quality: res.quality ?? s.quality,
            size: res.size ?? size,
            ...(picked.references && picked.references.length > 0
              ? { references: picked.references }
              : {}),
          };
          await addHistory(item, set, get);
          succeeded += 1;
          const elapsedNum = Number(res.elapsed);
          if (Number.isFinite(elapsedNum) && elapsedNum > maxElapsed) {
            maxElapsed = elapsedNum;
          }
          const elapsedMs = Math.round(elapsedNum * 1000) || (Date.now() - slotStartedAt);
          set((state) => ({
            inFlight: state.inFlight.map((f) =>
              f.id === flightId
                ? {
                    ...f,
                    status: "success",
                    endedAt: Date.now(),
                    elapsedMs,
                    phase: undefined,
                    filename: picked.filename,
                  }
                : f,
            ),
          }));
        } catch (err) {
          // Page is being torn down — server still owns the request and
          // reconcileInflight will restore it on the next load. Don't write
          // a misleading "error" mark.
          if (unloading) return;
          failed += 1;
          const msg = err instanceof Error ? err.message : "생성에 실패했습니다.";
          const errCode = (err as { code?: string } | null)?.code;
          const errStatus = (err as { status?: number } | null)?.status;
          console.warn(
            `[ima2][generate][${flightId}] FAILED in ` +
            `${Date.now() - slotStartedAt}ms code=${errCode ?? "?"} status=${errStatus ?? "?"}:`,
            err,
          );
          // 429 / USAGE_LIMIT cool-down DISABLED (2026-05-01) — ima2-router
          // pools several codex accounts and puts the offending one on its
          // own 5-min cooldown internally, then forwards the next batch
          // item to a different account. A client-side batch-stop hides
          // the rest of the pool's capacity, defeating the router. One
          // failed image is now just that image's failure; the batch
          // keeps going.
          // if (errCode === "USAGE_LIMIT" || errStatus === 429) {
          //   get().setUsageLimitedUntil(Date.now() + 5 * 60 * 1000);
          // }
          if (firstErrMsg === null) {
            firstErrMsg = msg;
          }
          set((state) => ({
            inFlight: state.inFlight.map((f) =>
              f.id === flightId
                ? {
                    ...f,
                    status: "error",
                    endedAt: Date.now(),
                    elapsedMs: Date.now() - slotStartedAt,
                    errorMessage: msg,
                    phase: undefined,
                  }
                : f,
            ),
          }));
        } finally {
          set((state) => ({
            activeGenerations: Math.max(0, state.activeGenerations - 1),
          }));
          saveInFlight(get().inFlight);
        }
      }),
    );

    if (succeeded > 0 && failed === 0) {
      const label = count === 1
        ? `${maxElapsed}초 만에 생성했습니다.`
        : `${succeeded}장을 ${maxElapsed}초 만에 생성했습니다.`;
      get().showToast(label);
    } else if (succeeded > 0 && failed > 0) {
      get().showToast(`${succeeded}/${count}장 생성 성공 (${failed}장 실패)`, true);
    } else {
      const cool = get().usageLimitedUntil;
      if (cool && cool > Date.now()) {
        get().showToast(
          "OpenAI 사용 한도에 도달했습니다. 5분간 새 생성을 중지합니다.",
          true,
        );
      } else {
        get().showToast(firstErrMsg ?? "생성에 실패했습니다.", true);
      }
    }
  },

  varyCurrentResult: async () => {
    const s = get();
    const promptFromResult = s.currentImage?.prompt;
    if (!promptFromResult) {
      s.showToast("복제할 결과가 없습니다", true);
      return;
    }
    await s.generate({ overridePrompt: promptFromResult, overrideCount: 1 });
  },

  hydrateHistory() {
    void (async () => {
      try {
        const res = await getHistory({ limit: HISTORY_LIMIT });
        const history: GenerateItem[] = res.items.map((it) => ({
          image: it.url,
          url: it.url,
          filename: it.filename,
          prompt: it.prompt || undefined,
          originalPrompt: it.originalPrompt || undefined,
          provider: it.provider,
          quality: it.quality || undefined,
          size: it.size || undefined,
          usage: (it.usage as GenerateItem["usage"]) ?? undefined,
          thumb: it.url,
          createdAt: it.createdAt,
          favorite: it.favorite === true,
          sessionId: it.sessionId ?? null,
          ...(it.references && it.references.length > 0
            ? { references: it.references }
            : {}),
        }));
        // Always replace the store, even when the response is empty. The
        // previous `if (history.length > 0)` guard meant a freshly logged-in
        // user with zero history would keep seeing the PREVIOUS account's
        // history — multi-user data leak (2026-04-30: dajug35 saw ree9622's
        // history because /api/history correctly returned 0 items but the
        // store kept the stale array).
        const selected = loadSelectedFilename();
        const matched = selected
          ? history.find((it) => it.filename === selected) ?? null
          : null;
        set({
          history,
          currentImage: matched ?? history[0] ?? null,
        });
        if (!matched) saveSelectedFilename(history[0]?.filename ?? null);
      } catch (err) {
        console.warn("[history] load failed:", err);
      }
    })();
  },

  showToast(message, error = false) {
    set({ toast: { message, error, id: Date.now() + Math.random() } });
  },
}), {
  name: "ima2.userPrefs",
  storage: createJSONStorage(() => localStorage),
  version: 1,
  // Whitelist exactly the right-panel inputs. Anything else (refs / history
  // / inflight / sessions / draft / sexy-tune state) is left to its existing
  // persistence path or is purposely transient.
  partialize: (state) => ({
    quality: state.quality,
    sizePreset: state.sizePreset,
    customW: state.customW,
    customH: state.customH,
    format: state.format,
    moderation: state.moderation,
    count: state.count,
  }),
}));

// ── Graph autosave (module-level debounce) ──
type GraphSaveReason =
  | "debounced"
  | "manual"
  | "switch-session"
  | "recovery"
  | "beforeunload"
  | "queued"
  | "retry-after-fail"
  | "delete-with-nodes";
type GraphSaveResult = "saved" | "skipped" | "conflict" | "failed";

const SAVE_DEBOUNCE_MS = 800;
const GRAPH_TAB_ID_KEY = "ima2.graphTabId";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let isSavingGraph = false;
let needsGraphSave = false;
let activeGraphSavePromise: Promise<void> | null = null;
let graphSaveSeq = 0;

function getGraphTabId(): string {
  try {
    const existing = sessionStorage.getItem(GRAPH_TAB_ID_KEY);
    if (existing) return existing;
    const next = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(GRAPH_TAB_ID_KEY, next);
    return next;
  } catch {
    return "tab_unavailable";
  }
}

function nextGraphSaveId(): string {
  return `gs_${Date.now().toString(36)}_${++graphSaveSeq}`;
}

async function reloadSessionAfterConflict(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const id = get().activeSessionId;
  if (!id) return;
  const { session } = await apiGetSession(id);
  const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
  set({
    graphNodes,
    graphEdges,
    activeSessionGraphVersion: graphVersion,
  });
  // P1-10: 5-second toast was too easy to miss when another tab silently
  // overwrote your changes. Use a blocking alert so the data loss is
  // explicit. Alert is intentionally intrusive — internal tool only.
  const msg = "다른 탭에서 변경이 감지되어 그래프를 최신 상태로 다시 불러왔습니다.\n방금 작업한 노드 일부가 사라졌을 수 있습니다.";
  try {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(msg);
    } else {
      get().showToast(msg, true);
    }
  } catch {
    get().showToast(msg, true);
  }
}

async function doSave(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason,
): Promise<GraphSaveResult> {
  const id = get().activeSessionId;
  const graphVersion = get().activeSessionGraphVersion;
  if (!id) return "skipped";
  if (graphVersion == null) return "skipped";
  const { graphNodes, graphEdges } = get();
  const nodes = graphNodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    data: n.data as unknown as Record<string, unknown>,
  }));
  const edges = graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: {},
  }));
  try {
    const res = await saveSessionGraph(id, graphVersion, nodes, edges, {
      saveId: nextGraphSaveId(),
      saveReason: reason,
      tabId: getGraphTabId(),
    });
    if (get().activeSessionId !== id) return "skipped";
    set({ activeSessionGraphVersion: res.graphVersion });
    return "saved";
  } catch (err) {
    if ((err as { status?: number }).status === 409) {
      await reloadSessionAfterConflict(get, set);
      return "conflict";
    }
    console.warn("[sessions] save failed:", err);
    try {
      get().showToast("그래프 저장에 실패했습니다. 잠시 후 자동 재시도합니다.", true);
    } catch {}
    return "failed";
  }
}

async function runGraphSaveQueue(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason,
): Promise<void> {
  if (isSavingGraph) {
    needsGraphSave = true;
    if (activeGraphSavePromise) await activeGraphSavePromise;
    return;
  }
  isSavingGraph = true;
  activeGraphSavePromise = (async () => {
    let nextReason = reason;
    let lastResult: GraphSaveResult = "saved";
    do {
      needsGraphSave = false;
      lastResult = await doSave(get, set, nextReason);
      if (lastResult === "conflict" || lastResult === "failed") break;
      nextReason = "queued";
    } while (needsGraphSave);
    // On failed/conflict, any save scheduled during the in-flight save was
    // dropped by the do-while break above. Re-schedule it via debounce so a
    // transient failure does not permanently lose later changes (P0-2).
    if (needsGraphSave && (lastResult === "failed" || lastResult === "conflict")) {
      setTimeout(() => scheduleGraphSaveImpl(get, set, "retry-after-fail"), 0);
    }
  })().finally(() => {
    isSavingGraph = false;
    activeGraphSavePromise = null;
  });
  await activeGraphSavePromise;
}

// DFS from `targetId` to see if it can already reach `sourceId`. If so,
// adding sourceId → targetId would close a cycle. Used by connectNodes to
// keep graph algorithms (topo sort, layout) terminating.
function wouldCreateCycle(edges: GraphEdge[], sourceId: string, targetId: string): boolean {
  const childrenByParent = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenByParent.has(e.source)) childrenByParent.set(e.source, []);
    childrenByParent.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const kids = childrenByParent.get(cur) ?? [];
    for (const k of kids) stack.push(k);
  }
  return false;
}

function scheduleGraphSaveImpl(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason = "debounced",
) {
  const s = get();
  if (!s.activeSessionId) return;
  if (s.sessionLoading) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void runGraphSaveQueue(get, set, reason);
  }, SAVE_DEBOUNCE_MS);
}

async function flushGraphSaveImpl(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason = "manual",
) {
  let shouldSaveNow = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    shouldSaveNow = true;
  }
  if (isSavingGraph) {
    needsGraphSave = true;
    if (activeGraphSavePromise) await activeGraphSavePromise;
    return;
  }
  if (shouldSaveNow) {
    await runGraphSaveQueue(get, set, reason);
  }
}

// Synchronous-ish save on page unload via sendBeacon
// (fetch in beforeunload is not reliable in modern browsers).
export function flushGraphSaveBeacon(get: () => AppState): void {
  const s = get();
  if (!s.activeSessionId) return;
  if (s.activeSessionGraphVersion == null) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const nodes = s.graphNodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    data: n.data as unknown as Record<string, unknown>,
  }));
  const edges = s.graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: {},
  }));
  const url = `/api/sessions/${encodeURIComponent(s.activeSessionId)}/graph`;
  const body = JSON.stringify({ nodes, edges });
  try {
    void fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(s.activeSessionGraphVersion),
        "X-Ima2-Graph-Save-Id": nextGraphSaveId(),
        "X-Ima2-Graph-Save-Reason": "beforeunload",
        "X-Ima2-Tab-Id": getGraphTabId(),
      },
      body,
      keepalive: true,
    });
  } catch {}
}

async function addHistory(
  item: GenerateItem,
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  _get: () => AppState,
): Promise<void> {
  // Insert into history IMMEDIATELY using the full image as a placeholder
  // thumbnail. compressImage on a 2K/4K base64 PNG can take 1–3 seconds,
  // and during that wait the inflight poller may finish the request on the
  // server side — leading to "큐에서 빠졌는데 갤러리에 늦게 추가" race.
  // We patch the real thumbnail in once compression completes.
  const url = item.filename ? `/generated/${item.filename}` : item.image;
  const withUrl: GenerateItem = {
    ...item,
    thumb: item.image ?? "",
    url,
    createdAt: item.createdAt || Date.now(),
  };
  saveSelectedFilename(withUrl.filename ?? null);
  set((state) => ({
    history: [withUrl, ...state.history].slice(0, HISTORY_LIMIT),
    currentImage: withUrl,
  }));

  // Background-compress and patch the thumbnail in place. Targets the item
  // by filename (which is the stable identifier) so concurrent batches
  // don't update each other's rows.
  compressImage(item.image)
    .then((thumb) => {
      if (!thumb || thumb === item.image) return;
      const targetFilename = withUrl.filename;
      set((state) => ({
        history: state.history.map((h) =>
          h.filename === targetFilename ? { ...h, thumb } : h,
        ),
        currentImage:
          state.currentImage && state.currentImage.filename === targetFilename
            ? ({ ...state.currentImage, thumb } as GenerateItem)
            : state.currentImage,
      }));
    })
    .catch(() => {
      // Thumbnail compression is purely cosmetic — failures are non-fatal.
    });
}
