import dagre from "dagre";
import type { GraphEdge, GraphNode } from "../store/useAppStore";
import { initialPos } from "./graph";

const NODE_X_GAP = 360;
const NODE_Y_GAP = 320;

export type LayoutDirection = "LR" | "TB";

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 380;

export function getChildNodes(
  parentId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphNode[] {
  const childIds = new Set(
    edges.filter((e) => e.source === parentId).map((e) => e.target),
  );
  return nodes.filter((n) => childIds.has(n.id));
}

// Pick the next position for a new root node based on the bottom-most
// existing root, so dragged-around nodes don't get stomped by a fresh `+`.
export function getNextRootPosition(nodes: GraphNode[]): { x: number; y: number } {
  const roots = nodes.filter((n) => !n.data.parentServerNodeId);
  if (roots.length === 0) return initialPos(0, 0);
  const maxY = Math.max(...roots.map((n) => n.position.y));
  return { x: initialPos(0, 0).x, y: maxY + NODE_Y_GAP };
}

// Place a child relative to the parent's actual position rather than depth
// indices — prevents overlap when the parent has been moved.
export function getNextChildPosition(
  parent: GraphNode,
  nodes: GraphNode[],
  edges: GraphEdge[],
): { x: number; y: number } {
  const children = getChildNodes(parent.id, nodes, edges);
  const x = parent.position.x + NODE_X_GAP;
  if (children.length === 0) return { x, y: parent.position.y };
  const maxY = Math.max(...children.map((n) => n.position.y));
  return { x, y: maxY + NODE_Y_GAP };
}

// dagre-based hierarchical autolayout. Returns nodes with new positions —
// edges are unchanged. Direction "LR" matches the existing left→right tree
// vibe; "TB" stacks generations top→bottom for screenshot/landscape work.
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: LayoutDirection = "LR",
): GraphNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 60 : 80,
    ranksep: direction === "LR" ? 120 : 90,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const measured = (n as { width?: number; height?: number });
    g.setNode(n.id, {
      width: measured.width ?? DEFAULT_NODE_WIDTH,
      height: measured.height ?? DEFAULT_NODE_HEIGHT,
    });
  }
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    // dagre returns center coordinates; react-flow uses top-left.
    const w = (n as { width?: number }).width ?? DEFAULT_NODE_WIDTH;
    const h = (n as { height?: number }).height ?? DEFAULT_NODE_HEIGHT;
    return {
      ...n,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}
