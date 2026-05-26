import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Spin, Tag, Toast } from "@douyinfe/semi-ui";
import { WKApp } from "@octo/base";
import {
  activateFlow,
  deactivateFlow,
  executeFlow,
  getFlow,
  getWebhookUrl,
  updateFlow,
} from "../api/flowApi";
import type { Flow, FlowDefinition, FlowStatus } from "../types/flow";
import FlowEditor from "../components/FlowEditor";

interface Props {
  flowId: string;
}

const STATUS_COLOR: Record<FlowStatus, "grey" | "green" | "amber"> = {
  draft: "grey",
  active: "green",
  disabled: "amber",
};

export default function FlowEditorPage({ flowId }: Props) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [definition, setDefinition] = useState<FlowDefinition>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [serverWebhookUrl, setServerWebhookUrl] = useState<string | null>(null);
  const definitionRef = useRef(definition);
  definitionRef.current = definition;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFlow(flowId)
      .then((f) => {
        if (cancelled) return;
        setFlow(f);
        setDefinition(f.definition ?? { nodes: [], edges: [] });
        setDirty(false);
      })
      .catch((e) => Toast.error(`加载失败：${(e as Error).message}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  // Best-effort fetch the canonical webhook URL from the server. Failure is
  // non-fatal — we fall back to a locally-derived URL so the copy button
  // still works during local dev.
  useEffect(() => {
    let cancelled = false;
    getWebhookUrl(flowId)
      .then((info) => {
        if (!cancelled && info.url) setServerWebhookUrl(info.url);
      })
      .catch(() => {
        // silently ignore; fallback URL is computed below
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const handleDefinitionChange = useCallback((next: FlowDefinition) => {
    setDefinition(next);
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!flow) return;
    setSaving(true);
    try {
      const updated = await updateFlow(flow.id, { definition: definitionRef.current });
      setFlow(updated);
      setDirty(false);
      Toast.success("已保存");
    } catch (e) {
      Toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!flow) return;
    try {
      const next = await activateFlow(flow.id);
      setFlow(next);
      Toast.success("已激活");
    } catch (e) {
      Toast.error(`激活失败：${(e as Error).message}`);
    }
  };

  const handleDeactivate = async () => {
    if (!flow) return;
    try {
      const next = await deactivateFlow(flow.id);
      setFlow(next);
      Toast.success("已停用");
    } catch (e) {
      Toast.error(`停用失败：${(e as Error).message}`);
    }
  };

  const handleExecute = async () => {
    if (!flow) return;
    try {
      const exec = await executeFlow(flow.id);
      Toast.success("已触发执行");
      WKApp.route.push("/flow/execution", { flowId: flow.id, executionId: exec.id });
    } catch (e) {
      Toast.error(`触发失败：${(e as Error).message}`);
    }
  };

  const openExecutions = () => {
    if (!flow) return;
    WKApp.route.push("/flow/executions", { flowId: flow.id });
  };

  const back = () => WKApp.route.push("/flow");

  if (loading || !flow) {
    return (
      <div style={{ padding: 32 }}>
        <Spin />
      </div>
    );
  }

  // Webhook URL prefers the server-issued value (POST /v1/flows/:id/webhook
  // is the runtime ingest path; GET returns the canonical URL). When the
  // server hasn't yet exposed it (or in offline dev) we fall back to the
  // locally-computed URL so the copy button still does something useful.
  const apiBase = (WKApp.apiClient.config.apiURL || "/api/v1/").replace(/\/$/, "");
  const fallbackWebhookUrl = `${window.location.origin}${apiBase}/flows/${flow.id}/webhook`;
  const webhookUrl = serverWebhookUrl || fallbackWebhookUrl;

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
        <Button size="small" onClick={back}>← 列表</Button>
        <div style={{ fontWeight: 600, marginLeft: 8 }}>{flow.name}</div>
        <Tag color={STATUS_COLOR[flow.status]} style={{ marginLeft: 4 }}>{flow.status}</Tag>
        {dirty && <Tag color="orange">未保存</Tag>}
        <div style={{ flex: 1 }} />
        <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
        {flow.status === "active" ? (
          <Button onClick={handleDeactivate}>停用</Button>
        ) : (
          <Button onClick={handleActivate}>激活</Button>
        )}
        <Button onClick={handleExecute}>手动执行</Button>
        <Button onClick={openExecutions}>执行历史</Button>
      </div>

      <FlowEditor
        definition={definition}
        onChange={handleDefinitionChange}
        webhookUrl={webhookUrl}
      />
    </div>
  );
}
