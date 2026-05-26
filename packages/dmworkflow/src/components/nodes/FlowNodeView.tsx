import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNodeConfig, NodeType } from "../../types/flow";
import { CATEGORY_COLORS, catalogFor } from "../../utils/nodeCatalog";

interface FlowNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  config: FlowNodeConfig;
  /** Optional runtime status overlay (used by ExecutionView). */
  status?: "pending" | "running" | "success" | "failed" | "cancelled";
}

const STATUS_GLYPH: Record<NonNullable<FlowNodeData["status"]>, string> = {
  pending: "⬜",
  running: "⏳",
  success: "✅",
  failed: "❌",
  cancelled: "⊘",
};

/**
 * Single canvas node renderer. Layout is the same for every category — the
 * category-specific affordances are color + icon + (optional) status glyph.
 */
export default function FlowNodeView({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const entry = catalogFor(d.nodeType);
  const category = entry?.category ?? "action";
  const color = CATEGORY_COLORS[category];
  const label = d.config?.label || entry?.label || d.nodeType;

  // Triggers have no inbound handle; everything else has both.
  const isTrigger = category === "trigger";

  return (
    <div
      style={{
        background: color.bg,
        border: `2px solid ${selected ? color.text : color.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: selected ? `0 0 0 3px ${color.border}33` : "0 1px 3px rgba(0,0,0,0.08)",
        color: color.text,
        fontSize: 13,
        fontWeight: 500,
        position: "relative",
      }}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} style={{ background: color.border }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{entry?.icon ?? "▢"}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {d.status && (
          <span title={d.status} style={{ fontSize: 16 }}>
            {STATUS_GLYPH[d.status]}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color.border }} />
    </div>
  );
}
