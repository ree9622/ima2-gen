import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppStore, type GraphNode, type GraphEdge } from "../store/useAppStore";
import { ImageNode } from "./ImageNode";

export function NodeCanvas() {
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const setGraphNodes = useAppStore((s) => s.setGraphNodes);
  const setGraphEdges = useAppStore((s) => s.setGraphEdges);
  const addRootNode = useAppStore((s) => s.addRootNode);

  const nodeTypes = useMemo(() => ({ imageNode: ImageNode }), []);

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

  return (
    <main className="node-canvas">
      {nodes.length === 0 ? (
        <button type="button" className="node-canvas__plus" onClick={() => addRootNode()}>
          + Add first node
        </button>
      ) : (
        <>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          <button
            type="button"
            className="node-canvas__add-root"
            onClick={() => addRootNode()}
            title="Add root node"
          >
            +
          </button>
        </>
      )}
    </main>
  );
}
