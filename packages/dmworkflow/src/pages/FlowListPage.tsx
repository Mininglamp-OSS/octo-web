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
import FlowEditorPage from "./FlowEditorPage";
import FlowExecutionsPage from "./FlowExecutionsPage";

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

  // 注意：列表页 (`/flow`) 由模块菜单 onPress 通过 `WKApp.routeRight.replaceToRoot`
  // 挂在右侧主区域，下面的子页面也必须通过同一个 routeRight 推进，否则 `WKApp.route.push`
  // 仅会调用 `restContent`，没有任何 listener 把它渲染出来 → 点击列表项无反应
  // (YUJ-2070, Bug 2)。统一沿用 SummaryListPage 的 popToRoot + push 范式。
  const openEditor = (id: string) => {
    WKApp.routeRight.popToRoot();
    WKApp.routeRight.push(<FlowEditorPage flowId={id} />);
  };

  const openExecutions = (id: string) => {
    WKApp.routeRight.popToRoot();
    WKApp.routeRight.push(<FlowExecutionsPage flowId={id} />);
  };

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      Toast.warning("请输入 Flow 名称");
      return;
    }
    setCreating(true);
    try {
      const flow = await createFlow({
        name,
        definition: { nodes: [], edges: [] },
      });
      setCreateOpen(false);
      setDraftName("");
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
        <Button type="primary" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
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
      >
        <div style={{ fontSize: 12, marginBottom: 4 }}>名称</div>
        <Input value={draftName} onChange={setDraftName} placeholder="my-first-flow" />
      </Modal>
    </div>
  );
}
