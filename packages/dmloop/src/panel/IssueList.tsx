import React, { useEffect, useRef, useState } from "react";
import { Table, Select, Tag, Typography, Button, Toast } from "@douyinfe/semi-ui";
import { Trash2, X } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue, IssueStatus, IssuePriority } from "../api/types";
import { updateIssue, batchUpdateIssues, batchDeleteIssues } from "../api/issueApi";
import AssigneePicker from "../ui/AssigneePicker";
import LabelChips from "../ui/LabelChips";
import RunningChip from "../ui/RunningChip";
import { confirmDelete } from "../ui/confirmDelete";
import { useRunConfirm } from "../ui/RunConfirmModal";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
} from "../ui/meta";

const { Text } = Typography;

// 批量操作下拉是纯命令菜单(选后触发动作、不持有值);受控 value 恒空。
const NO_VALUE = undefined as unknown as string;

export interface IssueListProps {
  issues: Issue[];
  onOpen: (id: string) => void;
  onChanged: () => void;
  /** 有 agent 正在跑的 issue-id 集合(标题旁 running chip)。 */
  running?: ReadonlySet<string>;
}

/** 列表视图：行内改 status/priority/assignee + 多选批量改删。 */
export default function IssueList({
  issues,
  onOpen,
  onChanged,
  running,
}: IssueListProps) {
  const { t } = useI18n();
  const { requestAssign, requestStatus, runConfirmModal } = useRunConfirm();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // busy 的同步镜像:setBusy 是异步的,confirmDelete 弹窗的 onOk 闭包捕获的是渲染时的
  // busy(可能陈旧),双击开两个弹窗/两次 onOk 会各自看到 busy=false 而重复批量写。ref
  // 在进入 runBatch 时同步置位,结构性挡住重入(setBusy 仅驱动 UI 的 disabled)。
  const busyRef = useRef(false);

  // 筛选/搜索/排序/翻页令 issues 变化后,裁掉已不可见的选中项 —— 否则批量条会对
  // 当前结果集看不到的行发批量写(改/删隐藏行)。只保留仍在可见集合里的 id。
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(issues.map((i) => i.id));
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [issues]);

  const patch = async (id: string, p: Parameters<typeof updateIssue>[1]) => {
    await updateIssue(id, p);
    onChanged();
  };

  // 批量:写失败 toast+中止;成功清选择+刷新。批量不走 RunConfirm 预览(显式批操作);
  // 且一律带 suppress_run —— 批量改状态/指派是管理性整理,绝不能每条静默起一个 agent run
  // (要派单请逐条走 RunConfirm 预览确认)。派单是有意的单条动作,不是批量副作用。
  // 重入守卫用 busyRef 同步置位(见上):任一触发器在途都挡住重叠批量写,不受闭包 stale 影响。
  const runBatch = async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      Toast.success(t("loop.batch.done"));
      setSelected([]);
      onChanged();
    } catch (e) {
      Toast.error((e as Error).message || t("loop.toast.saveFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const columns = [
    {
      title: "ID",
      dataIndex: "identifier",
      width: 96,
      render: (v: string) => (
        <Text type="tertiary" style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: t("loop.field.title"),
      dataIndex: "title",
      render: (v: string, r: Issue) => (
        <span className="loop-cell-title" onClick={() => onOpen(r.id)}>
          {v}
          {running?.has(r.id) && <RunningChip />}
          <LabelChips labels={r.labels} max={3} />
        </span>
      ),
    },
    {
      title: t("loop.field.status"),
      dataIndex: "status",
      width: 150,
      render: (v: IssueStatus, r: Issue) => (
        <Select
          value={v}
          size="small"
          borderless
          onChange={(nv) => requestStatus(r, nv as IssueStatus, (extra) => patch(r.id, { status: nv as IssueStatus, ...extra }))}
          style={{ width: 130 }}
        >
          {ISSUE_STATUS_ORDER.map((s) => (
            <Select.Option key={s} value={s}>
              <Tag color={ISSUE_STATUS_COLOR[s]} size="small">
                {t(`loop.status.${s}`)}
              </Tag>
            </Select.Option>
          ))}
        </Select>
      ),
    },
    {
      title: t("loop.field.priority"),
      dataIndex: "priority",
      width: 130,
      render: (v: IssuePriority, r: Issue) => (
        <Select
          value={v}
          size="small"
          borderless
          onChange={(nv) => patch(r.id, { priority: nv as IssuePriority })}
          style={{ width: 110 }}
        >
          {PRIORITY_ORDER.map((p) => (
            <Select.Option key={p} value={p}>
              <Tag color={PRIORITY_COLOR[p]} size="small">
                {t(`loop.priority.${p}`)}
              </Tag>
            </Select.Option>
          ))}
        </Select>
      ),
    },
    {
      title: t("loop.field.assignee"),
      dataIndex: "assignee_id",
      width: 180,
      render: (_v: string, r: Issue) => (
        <AssigneePicker
          size="small"
          value={r.assignee_id}
          valueName={r.assignee_name ?? null}
          onChange={(id, type, name) => requestAssign(r, type, id, name, (extra) => patch(r.id, { assignee_id: id, assignee_type: type, ...extra }))}
        />
      ),
    },
    {
      title: t("loop.field.project"),
      dataIndex: "project_name",
      width: 130,
      render: (v: string | null) => <Text>{v ?? "—"}</Text>,
    },
  ];

  return (
    <>
      {selected.length > 0 && (
        <div className="loop-batchbar">
          <Text strong>{t("loop.batch.selected", { values: { count: selected.length } })}</Text>
          <Select
            placeholder={t("loop.menu.changeStatus")}
            size="small"
            disabled={busy}
            value={NO_VALUE}
            onChange={(v) => runBatch(() => batchUpdateIssues(selected, { status: v as IssueStatus, suppress_run: true }))}
            style={{ width: 130 }}
          >
            {ISSUE_STATUS_ORDER.map((s) => (
              <Select.Option key={s} value={s}>{t(`loop.status.${s}`)}</Select.Option>
            ))}
          </Select>
          <Select
            placeholder={t("loop.menu.changePriority")}
            size="small"
            disabled={busy}
            value={NO_VALUE}
            onChange={(v) => runBatch(() => batchUpdateIssues(selected, { priority: v as IssuePriority, suppress_run: true }))}
            style={{ width: 120 }}
          >
            {PRIORITY_ORDER.map((p) => (
              <Select.Option key={p} value={p}>{t(`loop.priority.${p}`)}</Select.Option>
            ))}
          </Select>
          <AssigneePicker
            size="small"
            value={null}
            valueName={null}
            onChange={(id, type) => runBatch(() => batchUpdateIssues(selected, { assignee_id: id, assignee_type: type, suppress_run: true }))}
          />
          <Button
            size="small"
            type="danger"
            theme="borderless"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={() =>
              confirmDelete({
                title: t("loop.batch.deleteConfirm", { values: { count: selected.length } }),
                okText: t("loop.action.delete"),
                cancelText: t("loop.action.cancel"),
                onOk: () => runBatch(() => batchDeleteIssues(selected)),
              })
            }
          >
            {t("loop.action.delete")}
          </Button>
          <Button size="small" theme="borderless" icon={<X size={14} />} onClick={() => setSelected([])} aria-label={t("loop.action.cancel")} />
        </div>
      )}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={issues}
        pagination={false}
        size="small"
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected((keys ?? []) as string[]),
        }}
      />
      {runConfirmModal}
    </>
  );
}
