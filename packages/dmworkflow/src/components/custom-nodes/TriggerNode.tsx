import React from "react";
import type { NodeProps } from "@xyflow/react";
import BaseNodeView, { type BaseNodeData } from "./BaseNodeView";
import type { FlowNodeConfig, NodeType } from "../../types/flow";

/**
 * Trigger node — blue palette, no inbound handle.
 *
 * Accepts `data.subtype` so a single React Flow node type renders Webhook
 * (⚡), Cron (⏰), or Manual (👆). Falls back to `data.icon` when subtype
 * is missing.
 */
interface TriggerData extends BaseNodeData {
  subtype?: NodeType;
}

const SUBTYPE_META: Partial<Record<NodeType, { icon: string; label: string }>> = {
  "trigger.webhook": { icon: "⚡", label: "Webhook" },
  "trigger.cron": { icon: "⏰", label: "Cron" },
  "trigger.manual": { icon: "👆", label: "手动触发" },
};

function summarize(subtype: NodeType | undefined, config: FlowNodeConfig | undefined): string | undefined {
  if (!subtype || !config) return undefined;
  if (subtype === "trigger.cron" && config.cronExpression) return config.cronExpression;
  if (subtype === "trigger.webhook") return config.webhookUrl ? "已绑定 URL" : undefined;
  return undefined;
}

export default function TriggerNode(props: NodeProps) {
  const d = props.data as TriggerData;
  const meta = d.subtype ? SUBTYPE_META[d.subtype] : undefined;
  const merged: TriggerData = {
    ...d,
    icon: d.icon ?? meta?.icon ?? "⚡",
    label: d.label ?? meta?.label ?? "Trigger",
  };
  return (
    <BaseNodeView
      {...props}
      data={merged as unknown as Record<string, unknown>}
      category="trigger"
      isTrigger
      summary={summarize(d.subtype, d.config)}
    />
  );
}
