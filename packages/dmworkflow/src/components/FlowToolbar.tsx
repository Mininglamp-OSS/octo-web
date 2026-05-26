import React from "react";
import { Button, Tag } from "@douyinfe/semi-ui";
import type { Flow, FlowStatus } from "../types/flow";

interface Props {
  flow: Flow;
  /** Unsaved local edits in the editor. */
  dirty: boolean;
  /** Save in flight. */
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  onActivateToggle: () => void;
  onExecute: () => void;
  onOpenExecutions: () => void;
}

const STATUS_COLOR: Record<FlowStatus, "grey" | "green" | "amber"> = {
  draft: "grey",
  active: "green",
  disabled: "amber",
};

/**
 * Top bar shown above FlowEditor. Pulled out so the editor page stays
 * focused on save/load wiring and the toolbar can be reused (e.g. from a
 * future drawer-style editor).
 */
export default function FlowToolbar({
  flow,
  dirty,
  saving,
  onBack,
  onSave,
  onActivateToggle,
  onExecute,
  onOpenExecutions,
}: Props) {
  return (
    <div
      className="octo-flow-toolbar"
      style={{
        padding: "8px 16px",
        borderBottom: "1px solid var(--semi-color-border)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--semi-color-bg-1)",
      }}
    >
      <Button size="small" onClick={onBack}>← 列表</Button>
      <div style={{ fontWeight: 600, marginLeft: 8 }}>{flow.name}</div>
      <Tag color={STATUS_COLOR[flow.status]} style={{ marginLeft: 4 }}>{flow.status}</Tag>
      {dirty && <Tag color="orange">未保存</Tag>}
      <div style={{ flex: 1 }} />
      <Button type="primary" loading={saving} onClick={onSave}>保存</Button>
      <Button onClick={onActivateToggle}>
        {flow.status === "active" ? "停用" : "激活"}
      </Button>
      <Button onClick={onExecute}>手动执行</Button>
      <Button onClick={onOpenExecutions}>执行历史</Button>
    </div>
  );
}
