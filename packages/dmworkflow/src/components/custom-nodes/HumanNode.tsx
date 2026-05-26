import React from "react";
import type { NodeProps } from "@xyflow/react";
import BaseNodeView, { type BaseNodeData } from "./BaseNodeView";

/**
 * Human-in-the-loop node — orange palette. Phase 2 feature, so the palette
 * marks it disabled by default; here we render it as orange whenever it's
 * dropped onto the canvas, but `data.disabled` will dim it on hover/preview.
 */
export default function HumanNode(props: NodeProps) {
  const d = props.data as BaseNodeData;
  const merged: BaseNodeData = {
    ...d,
    icon: d.icon ?? "👤",
    label: d.label ?? "人工审批",
  };
  return (
    <BaseNodeView
      {...props}
      data={merged as unknown as Record<string, unknown>}
      category="human"
      summary="Phase 2"
    />
  );
}
