import React from "react";
import type { NodeProps } from "@xyflow/react";
import BaseNodeView, { type BaseNodeData } from "./BaseNodeView";

/**
 * HTTP node — green palette (action). Summary line shows METHOD + URL host.
 */
export default function HttpNode(props: NodeProps) {
  const d = props.data as BaseNodeData;
  const method = d.config?.httpMethod ?? "GET";
  const url = d.config?.httpUrl ?? "";
  let host = "";
  if (url) {
    try {
      host = new URL(url).host;
    } catch {
      host = url.length > 32 ? `${url.slice(0, 29)}…` : url;
    }
  }
  const merged: BaseNodeData = {
    ...d,
    icon: d.icon ?? "🌐",
    label: d.label ?? "HTTP",
  };
  return (
    <BaseNodeView
      {...props}
      data={merged as unknown as Record<string, unknown>}
      category="action"
      summary={host ? `${method} ${host}` : method}
    />
  );
}
