import type { GraphEdge, GraphNode } from "../store/useAppStore";

const STORAGE_KEY = "ima2.nodeTrash";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 50;

export type TrashItem = {
  id: string;
  deletedAt: number;
  label: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function loadTrash(): TrashItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return prune(parsed as TrashItem[]);
  } catch {
    return [];
  }
}

export function saveTrash(items: TrashItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prune(items)));
  } catch {
    // localStorage may be full or disabled; tolerate silently — trash is
    // a best-effort safety net, not durable storage.
  }
}

function prune(items: TrashItem[]): TrashItem[] {
  const cutoff = Date.now() - TTL_MS;
  const fresh = items.filter((it) => typeof it.deletedAt === "number" && it.deletedAt >= cutoff);
  // Newest first; cap to MAX_ITEMS so the store can't grow unbounded.
  fresh.sort((a, b) => b.deletedAt - a.deletedAt);
  return fresh.slice(0, MAX_ITEMS);
}

export function makeTrashItem(
  nodes: GraphNode[],
  edges: GraphEdge[],
): TrashItem {
  const sample = nodes.find((n) => n.data.prompt?.trim().length)?.data.prompt ?? "";
  const label =
    sample.trim().slice(0, 40) || `노드 ${nodes.length}개`;
  return {
    id: `trash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    deletedAt: Date.now(),
    label,
    nodes,
    edges,
  };
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}
