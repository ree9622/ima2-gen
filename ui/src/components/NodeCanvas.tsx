import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnectEnd,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppStore, type GraphNode, type GraphEdge } from "../store/useAppStore";
import { ImageNode } from "./ImageNode";
import { NodeBatchBar } from "./NodeBatchBar";
import {
  applyEdgeVisibility,
  applyVisibility,
  getFilteredOutIds,
  getHiddenNodeIds,
  unionHidden,
} from "../lib/nodeCollapse";
import { NodeSearchBar } from "./NodeSearchBar";
import { TrashModal } from "./TrashModal";

function readThemeColors() {
  if (typeof window === "undefined") {
    return {
      bg: "#0a0a0a",
      surface: "#141414",
      border: "#2a2a2a",
      accent: "#4a9eff",
    };
  }
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: get("--bg", "#0a0a0a"),
    surface: get("--surface", "#141414"),
    border: get("--border", "#2a2a2a"),
    accent: get("--accent", "#4a9eff"),
  };
}

function NodeCanvasInner() {
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const setGraphNodes = useAppStore((s) => s.setGraphNodes);
  const setGraphEdges = useAppStore((s) => s.setGraphEdges);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const addChildNodeAt = useAppStore((s) => s.addChildNodeAt);
  const connectNodes = useAppStore((s) => s.connectNodes);
  const deleteNodes = useAppStore((s) => s.deleteNodes);
  const nodeSelectionMode = useAppStore((s) => s.nodeSelectionMode);
  const selectNodeGraph = useAppStore((s) => s.selectNodeGraph);
  const sessionLoading = useAppStore((s) => s.sessionLoading);
  const autoLayoutGraph = useAppStore((s) => s.autoLayoutGraph);
  const nodeFilterText = useAppStore((s) => s.nodeFilterText);
  const nodeFilterStatuses = useAppStore((s) => s.nodeFilterStatuses);
  const trashCount = useAppStore((s) => s.trashedItems.length);
  const setTrashOpen = useAppStore((s) => s.setTrashOpen);

  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(() => ({ imageNode: ImageNode }), []);

  // Apply collapse + filter state by hiding nodes/edges before they reach
  // react-flow. Keeps the underlying store unchanged so save round-trips and
  // selection logic still see the full graph.
  const hiddenIds = useMemo(
    () =>
      unionHidden(
        getHiddenNodeIds(nodes, edges),
        getFilteredOutIds(nodes, nodeFilterText, nodeFilterStatuses),
      ),
    [nodes, edges, nodeFilterText, nodeFilterStatuses],
  );
  const visibleNodes = useMemo(
    () => applyVisibility(nodes, hiddenIds),
    [nodes, hiddenIds],
  );
  const visibleEdges = useMemo(
    () => applyEdgeVisibility(edges, hiddenIds),
    [edges, hiddenIds],
  );

  // Read theme tokens at runtime so the minimap / background follow the
  // active light/dark CSS variables instead of hardcoded hex.
  const [themeColors, setThemeColors] = useState(() => readThemeColors());
  useEffect(() => {
    const update = () => setThemeColors(readThemeColors());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setGraphNodes(applyNodeChanges(changes, nodes) as GraphNode[]),
    [nodes, setGraphNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setGraphEdges(applyEdgeChanges(changes, edges) as GraphEdge[]),
    [edges, setGraphEdges],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source && params.target) connectNodes(params.source, params.target);
    },
    [connectNodes],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid) return;
      const fromNodeId = connectionState.fromNode?.id;
      if (!fromNodeId) return;
      const clientX =
        "touches" in event ? event.changedTouches[0].clientX : (event as MouseEvent).clientX;
      const clientY =
        "touches" in event ? event.changedTouches[0].clientY : (event as MouseEvent).clientY;
      const pos = screenToFlowPosition({ x: clientX, y: clientY });
      addChildNodeAt(fromNodeId, pos);
    },
    [addChildNodeAt, screenToFlowPosition],
  );

  const onNodesDelete = useCallback(
    (deleted: GraphNode[]) => deleteNodes(deleted.map((n) => n.id)),
    [deleteNodes],
  );

  const onNodeClick: NodeMouseHandler<GraphNode> = useCallback(
    (event, node) => {
      if (!nodeSelectionMode) return;
      event.preventDefault();
      selectNodeGraph(node.id, event.metaKey || event.ctrlKey);
    },
    [nodeSelectionMode, selectNodeGraph],
  );

  const runAutoLayout = useCallback(
    (direction: "LR" | "TB") => {
      autoLayoutGraph(direction);
      // Wait one frame so react-flow picks up the new positions before
      // recomputing the viewport. Without this, fitView occasionally locks
      // onto the pre-layout bbox.
      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 320 });
      });
    },
    [autoLayoutGraph, fitView],
  );

  // 갤러리에서 노드 출처 이미지를 클릭하면 store가 pendingFocusNodeId를
  // 채운다. 캔버스가 그 노드로 카메라를 옮긴 뒤 즉시 클리어 — 같은 노드
  // 두 번째 click도 다시 발화하도록.
  const pendingFocusNodeId = useAppStore((s) => s.pendingFocusNodeId);
  const setPendingFocusNodeId = useAppStore((s) => s.setPendingFocusNodeId);
  useEffect(() => {
    if (!pendingFocusNodeId) return;
    if (!nodes.some((n) => n.id === pendingFocusNodeId)) {
      // 노드가 아직 그래프에 없으면 (세션 hydrate 진행 중) 다음 변화에서
      // 다시 시도. 클리어는 노드가 도착한 뒤로 미룬다.
      return;
    }
    fitView({
      nodes: [{ id: pendingFocusNodeId }],
      padding: 0.4,
      duration: 600,
      maxZoom: 1.2,
    });
    setPendingFocusNodeId(null);
  }, [pendingFocusNodeId, nodes, fitView, setPendingFocusNodeId]);

  return (
    <main className="node-canvas" ref={wrapperRef}>
      {sessionLoading && <div className="node-canvas__loading">세션 불러오는 중...</div>}
      {nodes.length === 0 ? (
        <div className="node-canvas__empty">
          <button type="button" className="node-canvas__plus" onClick={() => addRootNode()}>
            + 첫 노드 추가
          </button>
          {trashCount > 0 ? (
            <button
              type="button"
              className="node-canvas__empty-trash"
              onClick={() => setTrashOpen(true)}
            >
              🗑 휴지통 ({trashCount})에서 복구
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodesDelete={onNodesDelete}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            connectionRadius={32}
            selectionOnDrag={nodeSelectionMode}
            multiSelectionKeyCode={nodeSelectionMode ? null : undefined}
            panOnDrag={nodeSelectionMode ? [2] : true}
            fitView
            deleteKeyCode={nodeSelectionMode ? null : ["Delete", "Backspace"]}
            proOptions={{ hideAttribution: true }}
          >
            <NodeBatchBar />
            <Background gap={24} color={themeColors.border} />
            <Controls className="node-canvas__controls" />
            <MiniMap
              pannable
              zoomable
              maskColor={`color-mix(in srgb, ${themeColors.bg} 70%, transparent)`}
              nodeColor={themeColors.accent}
              nodeStrokeColor={themeColors.border}
              style={{
                background: themeColors.surface,
                border: `1px solid ${themeColors.border}`,
              }}
            />
          </ReactFlow>
          <button
            type="button"
            className="node-canvas__add-root"
            onClick={() => addRootNode()}
            title="루트 노드 추가"
          >
            +
          </button>
          <NodeSearchBar />
          <div className="node-canvas__layout-tools nodrag">
            <button
              type="button"
              onClick={() => runAutoLayout("LR")}
              title="자동 정렬 (가로 트리)"
            >
              ⇢ 가로 정렬
            </button>
            <button
              type="button"
              onClick={() => runAutoLayout("TB")}
              title="자동 정렬 (세로 트리)"
            >
              ⇣ 세로 정렬
            </button>
            <button
              type="button"
              onClick={() => fitView({ padding: 0.2, duration: 320 })}
              title="뷰 맞춤"
            >
              ⤢ 화면 맞춤
            </button>
            <button
              type="button"
              onClick={() => setTrashOpen(true)}
              title="휴지통 (삭제된 노드 복구)"
            >
              🗑 휴지통{trashCount > 0 ? ` (${trashCount})` : ""}
            </button>
          </div>
          <div className="node-canvas__hint">
            핸들을 빈 공간으로 드래그하면 새 브랜치가 생깁니다. Delete 또는 Backspace로 삭제할 수 있습니다.
          </div>
        </>
      )}
      <TrashModal />
    </main>
  );
}

export function NodeCanvas() {
  return (
    <ReactFlowProvider>
      <NodeCanvasInner />
    </ReactFlowProvider>
  );
}
