import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  ExecutionStatus,
  FlowDefinition,
  FlowNode,
  FlowNodeConfig,
  NodeType,
} from "../types/flow";
import Sidebar from "./Sidebar";
import NodeConfigPanel from "./NodeConfigPanel";
import FlowNodeView from "./nodes/FlowNodeView";

const nodeTypes = { flowNode: FlowNodeView };

interface FlowEditorProps {
  definition: FlowDefinition;
  onChange: (next: FlowDefinition) => void;
  /** Read-only mode for ExecutionView reuse. */
  readOnly?: boolean;
  /** Map of node-id → execution status overlay (read-only mode). */
  statusByNode?: Record<string, ExecutionStatus>;
  /** Currently selected node id in read-only mode (controlled by parent). */
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  /** Webhook URL surfaced inside the webhook trigger config form. */
  webhookUrl?: string;
}

function toReactFlow(def: FlowDefinition, statusByNode?: Record<string, ExecutionStatus>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = def.nodes.map((n) => ({
    id: n.id,
    type: "flowNode",
    position: n.position,
    data: {
      nodeType: n.type,
      config: n.config,
      status: statusByNode?.[n.id],
    },
  }));
  const edges: Edge[] = def.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ?? e.branch,
  }));
  return { nodes, edges };
}

function fromReactFlow(nodes: Node[], edges: Edge[]): FlowDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as { nodeType: NodeType }).nodeType,
      position: n.position,
      config: (n.data as { config: FlowNodeConfig }).config ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === "string" ? e.label : undefined,
      branch: typeof e.label === "string" ? e.label : undefined,
    })),
  };
}

function FlowEditorInner({
  definition,
  onChange,
  readOnly,
  statusByNode,
  selectedNodeId: controlledSelected,
  onSelectNode,
  webhookUrl,
}: FlowEditorProps) {
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => toReactFlow(definition, statusByNode), [definition, statusByNode]);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(controlledSelected ?? null);

  // Resync from outside when the upstream definition reference changes — this
  // happens after Save / load. Use a JSON shallow check to avoid clobbering
  // local in-flight edits when the parent merely re-renders with the same
  // logical content.
  const lastUpstreamRef = useRef(definition);
  if (lastUpstreamRef.current !== definition) {
    lastUpstreamRef.current = definition;
    const next = toReactFlow(definition, statusByNode);
    setNodes(next.nodes);
    setEdges(next.edges);
  }

  // Re-derive status overlay without losing local node positions.
  React.useEffect(() => {
    if (!statusByNode) return;
    setNodes((cur) => cur.map((n) => ({ ...n, data: { ...n.data, status: statusByNode[n.id] } })));
  }, [statusByNode]);

  React.useEffect(() => {
    if (controlledSelected !== undefined) setSelectedId(controlledSelected);
  }, [controlledSelected]);

  const emit = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      onChange(fromReactFlow(nextNodes, nextEdges));
    },
    [onChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((cur) => {
        const next = applyNodeChanges(changes, cur);
        if (!readOnly) emit(next, edges);
        return next;
      });
    },
    [edges, emit, readOnly],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((cur) => {
        const next = applyEdgeChanges(changes, cur);
        if (!readOnly) emit(nodes, next);
        return next;
      });
    },
    [nodes, emit, readOnly],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      setEdges((cur) => {
        const next = addEdge({ ...conn, id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }, cur);
        if (!readOnly) emit(nodes, next);
        return next;
      });
    },
    [nodes, emit, readOnly],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (readOnly) return;
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/octo-flow-node-type") as NodeType;
      if (!nodeType) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const node: Node = {
        id,
        type: "flowNode",
        position,
        data: { nodeType, config: {} },
      };
      setNodes((cur) => {
        const next = [...cur, node];
        emit(next, edges);
        return next;
      });
    },
    [edges, emit, readOnly, screenToFlowPosition],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setSelectedId(node.id);
      onSelectNode?.(node.id);
    },
    [onSelectNode],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedId(null);
    onSelectNode?.(null);
  }, [onSelectNode]);

  const selectedFlowNode: FlowNode | null = useMemo(() => {
    if (!selectedId) return null;
    const n = nodes.find((x) => x.id === selectedId);
    if (!n) return null;
    return {
      id: n.id,
      type: (n.data as { nodeType: NodeType }).nodeType,
      position: n.position,
      config: (n.data as { config: FlowNodeConfig }).config ?? {},
    };
  }, [nodes, selectedId]);

  const updateNodeConfig = useCallback(
    (nodeId: string, patchObj: Partial<FlowNodeConfig>) => {
      setNodes((cur) => {
        const next = cur.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: { ...(n.data as { config: FlowNodeConfig }).config, ...patchObj },
                },
              }
            : n,
        );
        emit(next, edges);
        return next;
      });
    },
    [edges, emit],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((cur) => {
        const nextNodes = cur.filter((n) => n.id !== nodeId);
        setEdges((curE) => {
          const nextE = curE.filter((e) => e.source !== nodeId && e.target !== nodeId);
          emit(nextNodes, nextE);
          return nextE;
        });
        return nextNodes;
      });
      setSelectedId(null);
      onSelectNode?.(null);
    },
    [emit, onSelectNode],
  );

  return (
    <div ref={wrapperRef} style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {!readOnly && <Sidebar />}
      <div style={{ flex: 1, minWidth: 0 }} onDrop={handleDrop} onDragOver={handleDragOver}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={readOnly ? undefined : handleConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          fitView
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {!readOnly && selectedFlowNode && (
        <NodeConfigPanel
          node={selectedFlowNode}
          webhookUrl={webhookUrl}
          onChange={updateNodeConfig}
          onClose={() => {
            setSelectedId(null);
            onSelectNode?.(null);
          }}
          onDelete={deleteNode}
        />
      )}
    </div>
  );
}

export default function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
