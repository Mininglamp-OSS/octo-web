import React, { useEffect, useMemo, useRef, useState } from "react";
import { Select, Button, Toast } from "@douyinfe/semi-ui";
import { Trash2, X } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue, IssueStatus, IssuePriority } from "../api/types";
import { batchUpdateIssues, batchDeleteIssues, updateIssue } from "../api/issueApi";
import AssigneePicker from "../ui/AssigneePicker";
import LabelChips from "../ui/LabelChips";
import RunningChip from "../ui/RunningChip";
import { confirmDelete } from "../ui/confirmDelete";
import { useRunConfirm } from "../ui/RunConfirmModal";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_ICON,
  ISSUE_STATUS_HEX,
  PRIORITY_ORDER,
  PRIORITY_ICON,
  PRIORITY_HEX,
} from "../ui/meta";
import { formatRelativeTime } from "../ui/time";

// 批量操作下拉是纯命令菜单(选后触发动作、不持有值);受控 value 恒空。
const NO_VALUE = undefined as unknown as string;

export interface IssueListProps {
  issues: Issue[];
  onOpen: (id: string) => void;
  onChanged: () => void;
  /** 有 agent 正在跑的 issue-id 集合(标题旁 running chip)。 */
  running?: ReadonlySet<string>;
}

/** 列表视图：按状态分组的清爽行 + 多选批量改删（对齐 Figma；行内编辑收敛到批量条与详情页）。 */
export default function IssueList({
  issues,
  onOpen,
  onChanged,
  running,
}: IssueListProps) {
  const { t, format } = useI18n();
  const { requestAssign, runConfirmModal } = useRunConfirm();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // busy 的同步镜像:setBusy 是异步的,confirmDelete 弹窗的 onOk 闭包捕获的是渲染时的
  // busy(可能陈旧),双击开两个弹窗/两次 onOk 会各自看到 busy=false 而重复批量写。ref
  // 在进入 runBatch 时同步置位,结构性挡住重入(setBusy 仅驱动 UI 的 disabled)。
  const busyRef = useRef(false);
  // 删除确认层的重入守卫:删除先开 Modal.confirm,busyRef 只在 onOk 进 runBatch 后才置位,
  // 故双击可在任一 OK 执行前叠开两个确认框;第一个 OK 跑完 runBatch 即复位 busyRef,第二个框
  // 的 OK 再次 batchDeleteIssues(同一批 ids)→ 重复删除。confirmingRef 在开框时同步置位、
  // onOk 完成/onCancel 时复位,把互斥下沉到确认框本身(codex 补审 #665 抓到)。
  const confirmingRef = useRef(false);

  // 行内指派改派（保留旧列表的行内编辑能力）：写库后刷新；触发 agent run 走 RunConfirm 预确认。
  const patch = async (id: string, p: Parameters<typeof updateIssue>[1]) => {
    await updateIssue(id, p);
    onChanged();
  };

  // 筛选/搜索/排序/翻页令 issues 变化后,裁掉已不可见的选中项 —— 否则批量条会对
  // 当前结果集看不到的行发批量写(改/删隐藏行)。只保留仍在可见集合里的 id。
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(issues.map((i) => i.id));
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [issues]);

  // 按状态分组（保留服务端返回的组内顺序，即用户所选排序）；仅渲染非空组。
  const groups = useMemo(
    () =>
      ISSUE_STATUS_ORDER.map((status) => ({
        status,
        rows: issues.filter((i) => i.status === status),
      })).filter((g) => g.rows.length > 0),
    [issues],
  );

  const selectedSet = new Set(selected);
  const toggleRow = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 批量:写失败 toast+中止;成功清选择+刷新。批量不走 RunConfirm 预览(显式批操作);
  // 且一律带 suppress_run —— 批量改状态/指派是管理性整理,绝不能每条静默起一个 agent run
  // (要派单请逐条走 RunConfirm 预览确认)。派单是有意的单条动作,不是批量副作用。
  // 重入守卫用 busyRef 同步置位:任一触发器在途都挡住重叠批量写,不受闭包 stale 影响。
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

  return (
    <>
      {selected.length > 0 && (
        <div className="loop-batchbar">
          <strong>{t("loop.batch.selected", { values: { count: selected.length } })}</strong>
          <Select
            placeholder={t("loop.menu.changeStatus")}
            size="small"
            disabled={busy}
            value={NO_VALUE}
            dropdownClassName="loop-fields__dropdown"
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
            dropdownClassName="loop-fields__dropdown"
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
            onClick={() => {
              if (confirmingRef.current) return; // 已有删除确认框在途,不叠开第二个
              confirmingRef.current = true;
              const ids = selected; // 快照:runBatch 成功会清空 selected,删除须用开框时捕获的 ids
              confirmDelete({
                title: t("loop.batch.deleteConfirm", { values: { count: ids.length } }),
                okText: t("loop.action.delete"),
                cancelText: t("loop.action.cancel"),
                onOk: async () => {
                  try { await runBatch(() => batchDeleteIssues(ids)); }
                  finally { confirmingRef.current = false; }
                },
                onCancel: () => { confirmingRef.current = false; },
              });
            }}
          >
            {t("loop.action.delete")}
          </Button>
          <Button size="small" theme="borderless" icon={<X size={14} />} onClick={() => setSelected([])} aria-label={t("loop.action.cancel")} />
        </div>
      )}

      <div className="loop-list">
        {groups.map((g) => {
          const StatusIcon = ISSUE_STATUS_ICON[g.status];
          return (
            <div key={g.status} className="loop-list__group">
              <div className="loop-list__group-head">
                <StatusIcon size={14} strokeWidth={2} style={{ color: ISSUE_STATUS_HEX[g.status] }} />
                <span className="loop-list__group-name">{t(`loop.status.${g.status}`)}</span>
                <em>{g.rows.length}</em>
              </div>
              {g.rows.map((r) => {
                const PriIcon = PRIORITY_ICON[r.priority];
                const checked = selectedSet.has(r.id);
                return (
                  <div key={r.id} className={`loop-list__row ${checked ? "is-selected" : ""}`}>
                    <label className="loop-list__check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleRow(r.id)} />
                    </label>
                    <span className="loop-list__icon" title={t(`loop.priority.${r.priority}`)}>
                      <PriIcon size={14} strokeWidth={2} style={{ color: PRIORITY_HEX[r.priority] }} />
                    </span>
                    <button className="loop-list__title" onClick={() => onOpen(r.id)}>
                      {r.title}
                      {running?.has(r.id) && <RunningChip />}
                    </button>
                    <LabelChips labels={r.labels} max={2} />
                    <span className="loop-list__spacer" />
                    {r.project_name && <span className="loop-list__project">{r.project_name}</span>}
                    <span className="loop-list__id">{r.identifier}</span>
                    <span className="loop-list__assignee" onClick={(e) => e.stopPropagation()}>
                      <AssigneePicker
                        size="small"
                        value={r.assignee_id}
                        valueName={r.assignee_name ?? null}
                        onChange={(id, type, name) => requestAssign(r, type, id, name, (extra) => patch(r.id, { assignee_id: id, assignee_type: type, ...extra }))}
                      />
                    </span>
                    <time className="loop-list__time">{formatRelativeTime(r.updated_at ?? r.created_at, format)}</time>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {runConfirmModal}
    </>
  );
}
