type EventHandler = (event: string, data: Record<string, unknown>) => void;

type Subscription = {
  requestId: string;
  handler: EventHandler;
};

const EVENT_TYPES = ["phase", "partial", "done", "error"];
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
export const JOB_EVENT_TIMEOUT_MS = 30 * 60 * 1_000;

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let lastEventId = "";
const subscriptions = new Set<Subscription>();
const openWaiters = new Set<{
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}>();

function resolveOpenWaiters() {
  for (const waiter of openWaiters) {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    waiter.resolve();
  }
  openWaiters.clear();
}

function rejectOpenWaiters(error: Error) {
  for (const waiter of openWaiters) {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    waiter.reject(error);
  }
  openWaiters.clear();
}

function eventsUrl() {
  return lastEventId
    ? `/api/events?lastEventId=${encodeURIComponent(lastEventId)}`
    : "/api/events";
}

function dispatch(eventType: string, event: MessageEvent) {
  if (event.lastEventId) lastEventId = event.lastEventId;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return;
  }
  const requestId = String(data.requestId ?? data.jobId ?? "");
  if (!requestId) return;
  for (const subscription of subscriptions) {
    if (subscription.requestId === requestId) {
      subscription.handler(eventType, data);
    }
  }
}

function connect() {
  if (source && source.readyState !== EventSource.CLOSED) return;
  const nextSource = new EventSource(eventsUrl());
  source = nextSource;
  nextSource.onopen = () => {
    if (source !== nextSource) return;
    reconnectAttempt = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    resolveOpenWaiters();
  };
  for (const eventType of EVENT_TYPES) {
    nextSource.addEventListener(eventType, (event) => dispatch(eventType, event as MessageEvent));
  }
  nextSource.addEventListener("replay-gap", () => {
    // Per-request callers recover terminal payloads through /api/node/result
    // when their timeout/reconciliation path runs.
  });
  nextSource.onerror = () => {
    nextSource.close();
    if (source !== nextSource) return;
    source = null;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };
}

export function ensureEventChannel(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Event channel wait aborted", "AbortError"));
  }
  if (source?.readyState === EventSource.OPEN) return Promise.resolve();
  const ready = new Promise<void>((resolve, reject) => {
    const waiter: {
      resolve: () => void;
      reject: (error: Error) => void;
      signal?: AbortSignal;
      onAbort?: () => void;
    } = { resolve, reject, signal };
    if (signal) {
      waiter.onAbort = () => {
        openWaiters.delete(waiter);
        reject(new DOMException("Event channel wait aborted", "AbortError"));
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
    }
    openWaiters.add(waiter);
  });
  connect();
  if (source?.readyState === EventSource.OPEN) resolveOpenWaiters();
  return ready;
}

export function subscribeToJob(requestId: string, handler: EventHandler) {
  const subscription = { requestId, handler };
  subscriptions.add(subscription);
  connect();
  return () => subscriptions.delete(subscription);
}

export function armJobEventTimeout(onTimeout: () => void, ms = JOB_EVENT_TIMEOUT_MS) {
  const timer = setTimeout(onTimeout, ms);
  return () => clearTimeout(timer);
}

export function disconnectEventChannel() {
  source?.close();
  source = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
  lastEventId = "";
  subscriptions.clear();
  rejectOpenWaiters(new Error("Event channel disconnected"));
}
