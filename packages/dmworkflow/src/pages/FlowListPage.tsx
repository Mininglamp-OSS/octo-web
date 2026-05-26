import React, { useCallback, useEffect, useState } from "react";
import { Button, Dropdown, Empty, Modal, Popconfirm, Spin, Tag, Toast, Input } from "@douyinfe/semi-ui";
import { IconPlus, IconRefresh, IconMore } from "@douyinfe/semi-icons";
import {
  activateFlow,
  createFlow,
  deactivateFlow,
  deleteFlow,
  listFlows,
} from "../api/flowApi";
import type { ExecutionStatus, Flow, FlowStatus } from "../types/flow";

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

interface Props {
  /** Open a flow's editor in the right pane. */
  onOpenEditor: (flowId: string) => void;
  /** Open a flow's execution history in the right pane. */
  onOpenExecutions: (flowId: string) => void;
}

/**
 * Octo Flow list — rendered inside the ~300 px left panel. Layout is therefore
 * compact: a single column of cards, with bulk actions tucked behind a kebab
 * menu. Editor / executions navigation is delegated to callbacks so this page
 * does not need to know that they live on the right pane.
 */
export default function FlowListPage({ onOpenEditor, onOpenExecutions }: Props) {
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
      // Optimistically prepend so the user sees it before the next reload.
      setFlows((cur) => [flow, ...cur]);
      onOpenEditor(flow.id);
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

  const renderItem = (flow: Flow) => {
    const lastExec = flow.last_execution_status as ExecutionStatus | null | undefined;
    return (
      <div
        key={flow.id}
        onClick={() => onOpenEditor(flow.id)}
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--semi-color-border)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={flow.name}
          >
            {flow.name}
          </div>
          <Tag size="small" color={STATUS_COLOR[flow.status]}>{flow.status}</Tag>
          <Dropdown
            position="bottomRight"
            trigger="click"
            render={(
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => onOpenEditor(flow.id)}>编辑</Dropdown.Item>
                <Dropdown.Item onClick={() => handleActivateToggle(flow)}>
                  {flow.status === "active" ? "停用" : "激活"}
                </Dropdown.Item>
                <Dropdown.Item onClick={() => onOpenExecutions(flow.id)}>执行历史</Dropdown.Item>
                <Dropdown.Divider />
                <Popconfirm
                  title="删除 Flow"
                  content="确认删除该 Flow？此操作不可恢复。"
                  onConfirm={() => handleDelete(flow)}
                >
                  <Dropdown.Item type="danger">删除</Dropdown.Item>
                </Popconfirm>
              </Dropdown.Menu>
            )}
          >
            <Button
              size="small"
              theme="borderless"
              icon={<IconMore />}
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--semi-color-text-2)",
          }}
        >
          {lastExec ? (
            <Tag size="small" color={EXEC_COLOR[lastExec]}>{lastExec}</Tag>
          ) : (
            <span>尚未执行</span>
          )}
          <span style={{ flex: 1 }} />
          <span>{flow.created_at ? new Date(flow.created_at).toLocaleDateString() : ""}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderBottom: "1px solid var(--semi-color-border)",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>Octo Flow</div>
        <Button size="small" icon={<IconRefresh />} onClick={load} aria-label="刷新" />
        <Button size="small" type="primary" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
          新建
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin />
          </div>
        ) : flows.length === 0 ? (
          <Empty
            style={{ paddingTop: 40 }}
            description="暂无 Flow，点击右上角「新建」开始编排。"
          />
        ) : (
          flows.map(renderItem)
        )}
      </div>

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
