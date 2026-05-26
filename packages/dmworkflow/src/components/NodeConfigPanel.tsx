import React from "react";
import { Button, Input } from "@douyinfe/semi-ui";
import { IconClose } from "@douyinfe/semi-icons";
import type { FlowNode, FlowNodeConfig } from "../types/flow";
import { CATEGORY_COLORS, catalogFor } from "../utils/nodeCatalog";
import ScriptConfig from "./configs/ScriptConfig";
import HttpConfig from "./configs/HttpConfig";
import ConditionConfig from "./configs/ConditionConfig";
import WebhookConfig from "./configs/WebhookConfig";
import CronConfig from "./configs/CronConfig";

interface Props {
  node: FlowNode | null;
  webhookUrl?: string;
  onChange: (nodeId: string, patch: Partial<FlowNodeConfig>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
}

/**
 * Right-side sliding panel. Stays mounted (width 0 when no selection) so the
 * Monaco editor doesn't re-init on every selection change.
 */
export default function NodeConfigPanel({ node, webhookUrl, onChange, onClose, onDelete }: Props) {
  if (!node) return null;
  const entry = catalogFor(node.type);
  const color = CATEGORY_COLORS[entry?.category ?? "action"];

  const patch = (p: Partial<FlowNodeConfig>) => onChange(node.id, p);

  return (
    <div
      style={{
        width: 360,
        borderLeft: "1px solid var(--semi-color-border)",
        background: "var(--semi-color-bg-1)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--semi-color-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: color.bg,
          color: color.text,
        }}
      >
        <span style={{ fontSize: 18 }}>{entry?.icon}</span>
        <span style={{ flex: 1, fontWeight: 600 }}>{entry?.label ?? node.type}</span>
        <Button size="small" type="tertiary" icon={<IconClose />} onClick={onClose} />
      </div>

      <div style={{ padding: 12, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>节点名称</div>
          <Input
            value={node.config.label ?? ""}
            placeholder={entry?.label ?? ""}
            onChange={(v) => patch({ label: v })}
          />
        </div>

        {node.type === "action.script" && <ScriptConfig config={node.config} onChange={patch} />}
        {node.type === "action.http" && <HttpConfig config={node.config} onChange={patch} />}
        {node.type === "logic.condition" && <ConditionConfig config={node.config} onChange={patch} />}
        {node.type === "trigger.webhook" && (
          <WebhookConfig config={node.config} onChange={patch} webhookUrl={webhookUrl} />
        )}
        {node.type === "trigger.cron" && <CronConfig config={node.config} onChange={patch} />}
        {node.type === "trigger.manual" && (
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
            手动触发节点无需额外配置。在 flow 详情页点击「手动执行」即可触发。
          </div>
        )}
        {node.type === "logic.parallel" && (
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
            并行节点会同时发出所有下游分支，无需额外配置。
          </div>
        )}
        {(node.type === "action.bot" || node.type === "human.approval") && (
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
            该节点类型属于 Phase 2，配置项尚未开放。
          </div>
        )}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--semi-color-border)" }}>
        <Button type="danger" theme="light" block onClick={() => onDelete(node.id)}>
          删除节点
        </Button>
      </div>
    </div>
  );
}
