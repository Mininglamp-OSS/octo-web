import React from "react";
import type { NodeProps } from "@xyflow/react";
import BaseNodeView, { type BaseNodeData } from "./BaseNodeView";

/**
 * Script node — green palette (action). Renders a one-line summary of the
 * script language so users can scan the canvas without opening the panel.
 */
export default function ScriptNode(props: NodeProps) {
  const d = props.data as BaseNodeData;
  const merged: BaseNodeData = {
    ...d,
    icon: d.icon ?? "📝",
    label: d.label ?? "Script",
  };
  const language = d.config?.scriptLanguage ?? "javascript";
  return (
    <BaseNodeView
      {...props}
      data={merged as unknown as Record<string, unknown>}
      category="action"
      summary={`lang: ${language}`}
    />
  );
}
