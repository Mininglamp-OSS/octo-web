import React, { useEffect, useMemo, useState } from "react";
import { Spin } from "@douyinfe/semi-ui";
import FlowEditor from "./FlowEditor";
import type {
  ExecutionStatus,
  Flow,
  FlowExecution,
  NodeExecutionState,
} from "../types/flow";
import { getExecution, listExecutions } from "../api/flowApi";

interface Props {
  flow: Flow;
  activeExecutionId: string | null;
  onSelectExecution: (id: string) => void;
}

const STATUS_GLYPH: Record<ExecutionStatus, string> = {
  pending: "⬜",
  running: "⏳",
  success: "✅",
  failed: "❌",
  cancelled: "⊘",
};

export default function ExecutionView({ flow, activeExecutionId, onSelectExecution }: Props) {
  const [executions, setExecutions] = useState<FlowExecution[]>([]);
  const [current, setCurrent] = useState<FlowExecution | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    listExecutions(flow.id)
      .then((items) => {
        if (!cancelled) setExecutions(items);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flow.id]);

  useEffect(() => {
    if (!activeExecutionId) {
      setCurrent(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    getExecution(activeExecutionId)
      .then((exec) => {
        if (!cancelled) setCurrent(exec);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeExecutionId]);

  const statusByNode = useMemo<Record<string, ExecutionStatus>>(() => {
    const map: Record<string, ExecutionStatus> = {};
    current?.node_states?.forEach((s) => {
      map[s.node_id] = s.status;
    });
    return map;
  }, [current]);

  const selectedNodeState: NodeExecutionState | undefined = useMemo(() => {
    if (!selectedNodeId) return undefined;
    return current?.node_states?.find((s) => s.node_id === selectedNodeId);
  }, [current, selectedNodeId]);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div
        style={{
          width: 240,
          borderRight: "1px solid var(--semi-color-border)",
          background: "var(--semi-color-bg-1)",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "8px 12px", fontWeight: 600, borderBottom: "1px solid var(--semi-color-border)" }}>
          执行历史
        </div>
        {loadingList ? (
          <div style={{ padding: 12 }}><Spin /></div>
        ) : executions.length === 0 ? (
          <div style={{ padding: 12, color: "var(--semi-color-text-2)", fontSize: 13 }}>暂无执行记录</div>
        ) : (
          executions.map((e) => (
            <div
              key={e.id}
              onClick={() => onSelectExecution(e.id)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid var(--semi-color-border)",
                background: e.id === activeExecutionId ? "var(--semi-color-fill-0)" : "transparent",
              }}
            >
              <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{STATUS_GLYPH[e.status]}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {new Date(e.started_at).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--semi-color-text-2)", marginTop: 2 }}>
                {e.trigger_type ?? "manual"} · {e.id.slice(0, 8)}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {loadingDetail && !current ? (
          <div style={{ padding: 24 }}><Spin /></div>
        ) : current ? (
          <FlowEditor
            definition={flow.definition}
            onChange={() => undefined}
            readOnly
            statusByNode={statusByNode}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        ) : (
          <div style={{ padding: 24, color: "var(--semi-color-text-2)" }}>选择左侧执行记录以查看节点状态</div>
        )}
        {selectedNodeState && (
          <div
            style={{
              borderTop: "1px solid var(--semi-color-border)",
              padding: 12,
              maxHeight: 240,
              overflowY: "auto",
              background: "var(--semi-color-bg-1)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              节点 {selectedNodeState.node_id} · {STATUS_GLYPH[selectedNodeState.status]} {selectedNodeState.status}
            </div>
            {selectedNodeState.error && (
              <div style={{ color: "var(--semi-color-danger)", fontSize: 12, marginBottom: 8 }}>
                {selectedNodeState.error}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>Input</div>
                <pre style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {JSON.stringify(selectedNodeState.input ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>Output</div>
                <pre style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {JSON.stringify(selectedNodeState.output ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
