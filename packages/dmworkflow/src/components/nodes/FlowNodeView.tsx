import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ExecutionStatus, FlowNodeConfig, NodeType } from "../../types/flow";
import { CATEGORY_COLORS, catalogFor } from "../../utils/nodeCatalog";

interface FlowNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  config: FlowNodeConfig;
  /** Optional runtime status overlay (used by ExecutionView). */
  status?: ExecutionStatus;
}

const STATUS_GLYPH: Record<ExecutionStatus, string> = {
  pending: "⬜",
  running: "⏳",
  success: "✅",
  failed: "❌",
  cancelled: "⊘",
};

/**
 * Color map mandated by the Phase 2 spec:
 *   success = green, failed = red, running = blue, pending = grey.
 * `cancelled` re-uses the grey palette but with an amber accent so users can
 * tell it apart from "never ran".
 */
export const STATUS_COLORS: Record<
  ExecutionStatus,
  { bg: string; border: string; text: string }
> = {
  pending: { bg: "#F2F3F5", border: "#A4ABB3", text: "#4E5969" },
  running: { bg: "#E6F2FF", border: "#2E7DFC", text: "#1257B8" },
  success: { bg: "#E6F7EA", border: "#3FB964", text: "#1F8A45" },
  failed: { bg: "#FDECEE", border: "#F5363C", text: "#B81C20" },
  cancelled: { bg: "#FFF5E6", border: "#D89614", text: "#9A5A00" },
};

/**
 * Single canvas node renderer. In the editor view we color the node by its
 * category; in the read-only execution view (when `data.status` is set) we
 * override with a status-driven palette so success/failed/running/pending is
 * legible at a glance.
 */
export default function FlowNodeView({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const entry = catalogFor(d.nodeType);
  const category = entry?.category ?? "action";
  const baseColor = CATEGORY_COLORS[category];
  const palette = d.status ? STATUS_COLORS[d.status] : baseColor;
  const label = d.config?.label || entry?.label || d.nodeType;

  // Triggers have no inbound handle; everything else has both.
  const isTrigger = category === "trigger";

  return (
    <div
      style={{
        background: palette.bg,
        border: `2px solid ${selected ? palette.text : palette.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: selected ? `0 0 0 3px ${palette.border}33` : "0 1px 3px rgba(0,0,0,0.08)",
        color: palette.text,
        fontSize: 13,
        fontWeight: 500,
        position: "relative",
      }}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} style={{ background: palette.border }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{entry?.icon ?? "▢"}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {d.status && (
          <span title={d.status} style={{ fontSize: 16 }}>
            {STATUS_GLYPH[d.status]}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: palette.border }} />
    </div>
  );
}
