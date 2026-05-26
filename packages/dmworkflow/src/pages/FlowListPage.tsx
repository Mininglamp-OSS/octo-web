import React, { useCallback, useEffect, useState } from "react";
import { Button, Modal, Popconfirm, Spin, Table, Tag, Toast, Input } from "@douyinfe/semi-ui";
import { IconPlus, IconRefresh } from "@douyinfe/semi-icons";
import { WKApp } from "@octo/base";
import {
  activateFlow,
  createFlow,
  deactivateFlow,
  deleteFlow,
  listFlows,
} from "../api/flowApi";
import type { ExecutionStatus, Flow, FlowStatus } from "../types/flow";
import { FLOW_TEMPLATES, findTemplate } from "../utils/flowTemplates";

const STATUS_COLOR: Record<FlowStatus, "grey" | "green" | "amber"> = {
  draft: "grey",
  active: "green",
  disabled: "amber",
};

const EXEC_COLOR: Record<ExecutionStatus, "grey" | "green" | "red" | "blue" | "orange"> = {
  pending: "grey",
  running: "blue",
  success: "green",
  failed: "red",
  cancelled: "orange",
};

export default function FlowListPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTemplateId, setDraftTemplateId] = useState<string>("blank");

  const load = useCallback(() => {
    setLoading(true);
    listFlows()
      .then(setFlows)
      .catch((e) => Toast.error(`加载失败：${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (id: string) => {
    WKApp.route.push("/flow/edit", { flowId: id });
  };

  const openExecutions = (id: string) => {
    WKApp.route.push("/flow/executions", { flowId: id });
  };

  const openCreate = () => {
    setDraftName("");
    setDraftTemplateId("blank");
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      Toast.warning("请输入 Flow 名称");
      return;
    }
    const template = findTemplate(draftTemplateId) ?? findTemplate("blank")!;
    setCreating(true);
    try {
      const flow = await createFlow({
        name,
        description: template.id === "blank" ? undefined : `From template: ${template.label}`,
        definition: template.build(),
      });
      setCreateOpen(false);
      setDraftName("");
      setDraftTemplateId("blank");
      openEditor(flow.id);
    } catch (e) {
      Toast.error(`创建失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleActivateToggle = async (flow: Flow) => {
    try {
      const next = flow.status === "active" ? await deactivateFlow(flow.id) : await activateFlow(flow.id);
      setFlows((cur) => cur.map((f) => (f.id === flow.id ? next : f)));
      Toast.success(next.status === "active" ? "已激活" : "已停用");
    } catch (e) {
      Toast.error(`操作失败：${(e as Error).message}`);
    }
  };

  const handleDelete = async (flow: Flow) => {
    try {
      await deleteFlow(flow.id);
      setFlows((cur) => cur.filter((f) => f.id !== flow.id));
      Toast.success("已删除");
    } catch (e) {
      Toast.error(`删除失败：${(e as Error).message}`);
    }
  };

  return (
    <div style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600, flex: 1 }}>Octo Flow</div>
        <Button icon={<IconRefresh />} onClick={load} style={{ marginRight: 8 }}>刷新</Button>
        <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
          新建 Flow
        </Button>
      </div>

      {loading ? (
        <Spin />
      ) : (
        <Table
          dataSource={flows}
          rowKey="id"
          pagination={false}
          empty="暂无 Flow，点击右上角新建"
          columns={[
            {
              title: "名称",
              dataIndex: "name",
              render: (name: string, flow: Flow) => (
                <a onClick={() => openEditor(flow.id)} style={{ cursor: "pointer" }}>{name}</a>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (status: FlowStatus) => <Tag color={STATUS_COLOR[status]}>{status}</Tag>,
            },
            {
              title: "最近执行",
              dataIndex: "last_execution_status",
              width: 140,
              render: (status: ExecutionStatus | null | undefined) =>
                status ? <Tag color={EXEC_COLOR[status]}>{status}</Tag> : <span style={{ color: "var(--semi-color-text-2)" }}>—</span>,
            },
            {
              title: "创建时间",
              dataIndex: "created_at",
              width: 180,
              render: (v: string) => (v ? new Date(v).toLocaleString() : "—"),
            },
            {
              title: "操作",
              width: 280,
              render: (_: unknown, flow: Flow) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <Button size="small" onClick={() => openEditor(flow.id)}>编辑</Button>
                  <Button size="small" onClick={() => handleActivateToggle(flow)}>
                    {flow.status === "active" ? "停用" : "激活"}
                  </Button>
                  <Button size="small" onClick={() => openExecutions(flow.id)}>执行历史</Button>
                  <Popconfirm
                    title="删除 Flow"
                    content="确认删除该 Flow？此操作不可恢复。"
                    onConfirm={() => handleDelete(flow)}
                  >
                    <Button size="small" type="danger">删除</Button>
                  </Popconfirm>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal
        title="新建 Flow"
        visible={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建"
        width={520}
      >
        <div style={{ fontSize: 12, marginBottom: 4 }}>名称</div>
        <Input value={draftName} onChange={setDraftName} placeholder="my-first-flow" />

        <div style={{ fontSize: 12, marginTop: 16, marginBottom: 6 }}>模板</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {FLOW_TEMPLATES.map((tpl) => {
            const active = tpl.id === draftTemplateId;
            return (
              <div
                key={tpl.id}
                role="button"
                tabIndex={0}
                onClick={() => setDraftTemplateId(tpl.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDraftTemplateId(tpl.id);
                  }
                }}
                style={{
                  cursor: "pointer",
                  padding: "10px 12px",
                  border: `1px solid ${active ? "var(--semi-color-primary)" : "var(--semi-color-border)"}`,
                  borderRadius: 6,
                  background: active ? "var(--semi-color-primary-light-default)" : "transparent",
                  outline: "none",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `2px solid ${active ? "var(--semi-color-primary)" : "var(--semi-color-border)"}`,
                    background: active ? "var(--semi-color-primary)" : "transparent",
                    flexShrink: 0,
                    marginTop: 3,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{tpl.label}</div>
                  <div style={{ fontSize: 12, color: "var(--semi-color-text-2)", marginTop: 2 }}>
                    {tpl.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
