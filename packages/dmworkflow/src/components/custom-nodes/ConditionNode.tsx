import React from "react";
import type { NodeProps } from "@xyflow/react";
import BaseNodeView, { type BaseNodeData } from "./BaseNodeView";

/**
 * Condition node — purple palette (logic). Summary surfaces the configured
 * expression so the canvas reads as "if X then …".
 */
export default function ConditionNode(props: NodeProps) {
  const d = props.data as BaseNodeData;
  const expr = d.config?.conditionExpression;
  const merged: BaseNodeData = {
    ...d,
    icon: d.icon ?? "🔀",
    label: d.label ?? "Condition",
  };
  return (
    <BaseNodeView
      {...props}
      data={merged as unknown as Record<string, unknown>}
      category="logic"
      summary={expr ? `if ${expr}` : undefined}
    />
  );
}
