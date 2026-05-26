import React from "react";
import { NODE_CATALOG, CATEGORY_COLORS } from "../utils/nodeCatalog";
import type { NodeCategory } from "../types/flow";

const CATEGORY_LABEL: Record<NodeCategory, string> = {
  trigger: "触发器",
  logic: "逻辑",
  action: "动作",
  human: "人工",
};

/**
 * Left-rail palette. Each draggable item attaches its node type via the
 * `application/octo-flow-node-type` MIME so FlowEditor can read it on drop.
 */
export default function Sidebar() {
  const grouped: Record<NodeCategory, typeof NODE_CATALOG> = {
    trigger: [],
    logic: [],
    action: [],
    human: [],
  };
  for (const entry of NODE_CATALOG) {
    grouped[entry.category].push(entry);
  }

  return (
    <div
      style={{
        width: 220,
        borderRight: "1px solid var(--semi-color-border)",
        background: "var(--semi-color-bg-1)",
        padding: 12,
        overflowY: "auto",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>节点</div>
      {(Object.keys(grouped) as NodeCategory[]).map((cat) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)", marginBottom: 6 }}>
            {CATEGORY_LABEL[cat]}
          </div>
          {grouped[cat].map((entry) => {
            const c = CATEGORY_COLORS[cat];
            return (
              <div
                key={entry.type}
                draggable={!entry.disabled}
                onDragStart={(e) => {
                  if (entry.disabled) return;
                  e.dataTransfer.setData("application/octo-flow-node-type", entry.type);
                  e.dataTransfer.effectAllowed = "move";
                }}
                title={entry.disabled ? "Phase 2 — 暂未启用" : entry.description}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  marginBottom: 4,
                  background: entry.disabled ? "var(--semi-color-fill-0)" : c.bg,
                  border: `1px solid ${entry.disabled ? "var(--semi-color-border)" : c.border}`,
                  borderRadius: 6,
                  color: entry.disabled ? "var(--semi-color-text-3)" : c.text,
                  cursor: entry.disabled ? "not-allowed" : "grab",
                  opacity: entry.disabled ? 0.6 : 1,
                  fontSize: 13,
                  userSelect: "none",
                }}
              >
                <span style={{ fontSize: 16 }}>{entry.icon}</span>
                <span>{entry.label}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
