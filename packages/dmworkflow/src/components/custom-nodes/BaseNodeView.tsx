import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ExecutionStatus, FlowNodeConfig, NodeCategory } from "../../types/flow";

/**
 * BaseNodeView is the shared visual shell used by every per-category node
 * component (TriggerNode / ScriptNode / HttpNode / ConditionNode / HumanNode).
 *
 * The category-specific files declare their own React Flow node type so that
 * FlowEditor can register them via `nodeTypes`, but they all delegate the
 * actual rendering here for a consistent look. Only the category palette is
 * different per file — that's what the task spec ("Trigger 蓝色 / Action 绿色
 * / Logic 紫色 / Human 橙色") asks for.
 */

export interface BaseNodeData extends Record<string, unknown> {
  /** Display label (falls back to category default). */
  label?: string;
  /** Emoji or single-char icon shown on the node. */
  icon?: string;
  /** Snapshot of the node's typed configuration (for config-summary line). */
  config?: FlowNodeConfig;
  /** Optional execution-status overlay rendered in the corner. */
  status?: ExecutionStatus;
  /** Disabled (Phase 2 stubs) — render in grey, no execution glyph. */
  disabled?: boolean;
}

const STATUS_GLYPH: Record<ExecutionStatus, string> = {
  pending: "⬜",
  running: "⏳",
  success: "✅",
  failed: "❌",
  cancelled: "⊘",
};

const PALETTE: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  // Issue spec colors:
  //   trigger 蓝色 #3B82F6, action 绿色 #10B981,
  //   logic 紫色 #8B5CF6,  human 橙色 #F59E0B
  trigger: { bg: "#EFF6FF", border: "#3B82F6", text: "#1D4ED8" },
  action: { bg: "#ECFDF5", border: "#10B981", text: "#047857" },
  logic: { bg: "#F5F3FF", border: "#8B5CF6", text: "#6D28D9" },
  human: { bg: "#FFFBEB", border: "#F59E0B", text: "#B45309" },
};

const DISABLED = { bg: "#F3F4F6", border: "#9CA3AF", text: "#6B7280" };

interface Props extends NodeProps {
  category: NodeCategory;
  /** When true, hides the inbound (target) handle — used for trigger nodes. */
  isTrigger?: boolean;
  /** Optional one-line summary rendered under the label (e.g. cron expr). */
  summary?: string;
}

export default function BaseNodeView({ data, selected, category, isTrigger, summary }: Props) {
  const d = data as BaseNodeData;
  const palette = d.disabled ? DISABLED : PALETTE[category];
  const label = d.label ?? "";
  const icon = d.icon ?? "▢";

  return (
    <div
      className={`octo-flow-node octo-flow-node--${category}${d.disabled ? " is-disabled" : ""}${
        selected ? " is-selected" : ""
      }`}
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
        opacity: d.disabled ? 0.7 : 1,
      }}
    >
      {!isTrigger && (
        <Handle type="target" position={Position.Left} style={{ background: palette.border }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {d.status && !d.disabled && (
          <span title={d.status} style={{ fontSize: 16 }}>
            {STATUS_GLYPH[d.status]}
          </span>
        )}
      </div>
      {summary && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: palette.text,
            opacity: 0.75,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: palette.border }} />
    </div>
  );
}

export { PALETTE as NODE_PALETTE };
