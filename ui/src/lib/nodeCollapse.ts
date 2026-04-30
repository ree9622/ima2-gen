import type {
  GraphEdge,
  GraphNode,
  ImageNodeStatus,
} from "../store/useAppStore";

// Returns the set of all descendants of `parentId` (children, grandchildren, ...).
// Excludes the parent itself. Cycle-safe via a visited set.
export function getDescendantIds(
  parentId: string,
  edges: GraphEdge[],
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenByParent.has(e.source)) childrenByParent.set(e.source, []);
    childrenByParent.get(e.source)!.push(e.target);
  }
  const out = new Set<string>();
  const stack = [parentId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const kids = childrenByParent.get(cur) ?? [];
    for (const k of kids) {
      if (out.has(k)) continue;
      out.add(k);
      stack.push(k);
    }
  }
  return out;
}

// Returns the set of node ids that should be hidden because some ancestor is
// collapsed. A node is hidden iff *any* ancestor on at least one path is
// marked collapsed — that matches user expectation of "I folded this away".
export function getHiddenNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Set<string> {
  const hidden = new Set<string>();
  for (const n of nodes) {
    if (n.data.collapsed !== true) continue;
    for (const id of getDescendantIds(n.id, edges)) hidden.add(id);
  }
  return hidden;
}

// Direct child count for a node — used by the UI to label the collapse toggle.
export function getDirectChildCount(
  parentId: string,
  edges: GraphEdge[],
): number {
  let n = 0;
  for (const e of edges) if (e.source === parentId) n++;
  return n;
}

export function applyVisibility<T extends { id: string; hidden?: boolean }>(
  items: T[],
  hiddenIds: Set<string>,
): T[] {
  let changed = false;
  const next = items.map((item) => {
    const shouldHide = hiddenIds.has(item.id);
    if (Boolean(item.hidden) === shouldHide) return item;
    changed = true;
    return { ...item, hidden: shouldHide };
  });
  return changed ? next : items;
}

// Returns the set of node ids hidden by the active filter. A node is hidden
// if it does NOT match the filter (text + status). Empty filters disable
// the entire mechanism so nothing is hidden.
//
// Matching policy: a hit must satisfy every active dimension (AND across
// dimensions, OR within statuses).
export function getFilteredOutIds(
  nodes: GraphNode[],
  filterText: string,
  filterStatuses: ImageNodeStatus[],
): Set<string> {
  const out = new Set<string>();
  const text = filterText.trim().toLowerCase();
  const hasText = text.length > 0;
  const hasStatus = filterStatuses.length > 0;
  if (!hasText && !hasStatus) return out;

  for (const n of nodes) {
    const promptOk = hasText
      ? (n.data.prompt ?? "").toLowerCase().includes(text)
      : true;
    const statusOk = hasStatus ? filterStatuses.includes(n.data.status) : true;
    if (!promptOk || !statusOk) out.add(n.id);
  }
  return out;
}

// Combine multiple hidden-id sources (collapse + filter) into one set.
export function unionHidden(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const id of s) out.add(id);
  return out;
}

// For edges: hide an edge whenever its source OR target is hidden, so dangling
// edges don't render into empty space.
export function applyEdgeVisibility(
  edges: GraphEdge[],
  hiddenNodeIds: Set<string>,
): GraphEdge[] {
  let changed = false;
  const next = edges.map((edge) => {
    const shouldHide = hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target);
    if (Boolean(edge.hidden) === shouldHide) return edge;
    changed = true;
    return { ...edge, hidden: shouldHide };
  });
  return changed ? next : edges;
}
