import React, { useEffect, useState } from "react";
import { Button, Spin, Toast } from "@douyinfe/semi-ui";
import { WKApp } from "@octo/base";
import { getFlow } from "../api/flowApi";
import type { Flow } from "../types/flow";
import ExecutionView from "../components/ExecutionView";

interface Props {
  flowId: string;
  executionId?: string | null;
  /** Return to the previous right-pane view (typically the editor). Defaults to `routeRight.pop()`. */
  onBack?: () => void;
  /** Close the right pane entirely and return to the list. Defaults to `routeRight.popToRoot()`. */
  onClose?: () => void;
}

export default function FlowExecutionsPage({ flowId, executionId, onBack, onClose }: Props) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(executionId ?? null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFlow(flowId)
      .then((f) => {
        if (!cancelled) setFlow(f);
      })
      .catch((e) => Toast.error(`加载失败：${(e as Error).message}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  useEffect(() => {
    if (executionId) setActive(executionId);
  }, [executionId]);

  if (loading || !flow) {
    return <div style={{ padding: 32 }}><Spin /></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--semi-color-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--semi-color-bg-1)",
        }}
      >
        <Button size="small" onClick={() => (onBack ? onBack() : WKApp.routeRight.pop())}>← 编辑器</Button>
        <div style={{ fontWeight: 600, marginLeft: 8 }}>{flow.name} · 执行历史</div>
        <div style={{ flex: 1 }} />
        <Button size="small" onClick={() => (onClose ? onClose() : WKApp.routeRight.popToRoot())}>返回列表</Button>
      </div>
      <ExecutionView flow={flow} activeExecutionId={active} onSelectExecution={setActive} />
    </div>
  );
}
