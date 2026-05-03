import { Panel } from "@xyflow/react";
import { useAppStore } from "../store/useAppStore";
import {
  getUnselectedDownstreamIds,
  nodeHasImage,
  type NodeBatchMode,
} from "../lib/nodeBatch";

export function NodeBatchBar() {
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const nodeSelectionMode = useAppStore((s) => s.nodeSelectionMode);
  const nodeBatchRunning = useAppStore((s) => s.nodeBatchRunning);
  const nodeBatchStopping = useAppStore((s) => s.nodeBatchStopping);
  const toggleNodeSelectionMode = useAppStore((s) => s.toggleNodeSelectionMode);
  const selectAllGraphNodes = useAppStore((s) => s.selectAllGraphNodes);
  const clearNodeSelection = useAppStore((s) => s.clearNodeSelection);
  const runNodeBatch = useAppStore((s) => s.runNodeBatch);
  const cancelNodeBatch = useAppStore((s) => s.cancelNodeBatch);
  const disconnectEdges = useAppStore((s) => s.disconnectEdges);

  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
  const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
  const selectedSet = new Set(selectedIds);
  const missingCount = nodes.filter((n) => selectedSet.has(n.id) && !nodeHasImage(n)).length;
  const staleImpact = getUnselectedDownstreamIds(edges, selectedIds).length;

  const run = (mode: NodeBatchMode) => {
    void runNodeBatch(mode);
  };

  return (
    <Panel position="top-center" className="node-batch-bar nodrag">
      <button type="button" onClick={toggleNodeSelectionMode} aria-pressed={nodeSelectionMode}>
        {nodeSelectionMode ? "선택 모드 켜짐" : "선택 모드 꺼짐"}
      </button>
      <button type="button" onClick={selectAllGraphNodes} disabled={nodes.length === 0}>
        전체 선택
      </button>
      {selectedEdgeIds.length > 0 ? (
        <button
          type="button"
          className="node-batch-bar__danger"
          onClick={() => disconnectEdges(selectedEdgeIds)}
          title="선택한 연결선 끊기"
          aria-label="선택한 연결선 끊기"
        >
          연결선 끊기 ({selectedEdgeIds.length})
        </button>
      ) : null}
      {selectedIds.length > 0 ? (
        <>
          <span className="node-batch-bar__meta">
            선택 {selectedIds.length} · 미완료 {missingCount} · 영향 {staleImpact}
          </span>
          <button
            type="button"
            onClick={() => run("missing-only")}
            disabled={nodeBatchRunning}
          >
            누락만 생성
          </button>
          {/* "모두 재생성" temporarily removed — implementation arrives with B2 in-place regen.
              Old button always landed on "실행할 노드가 없습니다" because regenerate-all
              path uses the same missing-only filter (P0-4). */}
          {nodeBatchRunning ? (
            <button type="button" onClick={cancelNodeBatch} disabled={nodeBatchStopping}>
              {nodeBatchStopping ? "중지 중..." : "남은 작업 중지"}
            </button>
          ) : null}
          <button type="button" onClick={clearNodeSelection} disabled={nodeBatchRunning}>
            선택 해제
          </button>
        </>
      ) : null}
    </Panel>
  );
}
