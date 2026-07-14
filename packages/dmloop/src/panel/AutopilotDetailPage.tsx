import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Spin, Switch, Typography, Toast, Select, Modal } from "@douyinfe/semi-ui";
import { ChevronRight, Plus, Pencil, Trash2, Play, Clock, Save } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Autopilot, AutopilotTrigger, AutopilotRun, AutopilotStatus, AutopilotAssigneeType, AssigneeType } from "../api/types";
import {
  getAutopilot,
  listAutopilotRuns,
  updateAutopilot,
  deleteAutopilot,
  triggerAutopilot,
  updateAutopilotTrigger,
  deleteAutopilotTrigger,
} from "../api/autopilotApi";
import { listProjectOptions } from "../api/directory";
import { confirmDelete } from "../ui/confirmDelete";
import AssigneePicker from "../ui/AssigneePicker";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
import LoopTag from "../ui/LoopTag";
import LoopButton from "../ui/LoopButton";
import { AUTOPILOT_RUN_DOT, AUTOPILOT_RUN_DOT_FALLBACK } from "../ui/meta";
import { formatRelativeTime, formatDurationMs } from "../ui/time";
import { parseCron, describeSchedule, formatNextRunAt } from "../ui/autopilotSchedule";
import TriggerEditModal from "../ui/TriggerEditModal";
import IssueDetailPage from "./IssueDetailPage";
import "./sideDetail.css";

const { Text } = Typography;

const STATUS_TAG: Record<AutopilotStatus, "green" | "grey"> = {
  active: "green",
  paused: "grey",
  archived: "grey",
};

/** 属性栏名称的内联编辑：点击文字进入输入，失焦/回车保存。 */
function InlineName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
  };
  if (editing) {
    return (
      <input
        autoFocus
        className="loop-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button type="button" className="loop-apd__name-btn" onClick={() => setEditing(true)}>
      <span>{value || "—"}</span>
      <Pencil size={12} className="loop-apd__name-edit" />
    </button>
  );
}

export default function AutopilotDetailPage({ autopilotId, onChanged }: { autopilotId: string; onChanged?: () => void }) {
  const { t, format } = useI18n();
  const [autopilot, setAutopilot] = useState<Autopilot | null>(null);
  const [triggers, setTriggers] = useState<AutopilotTrigger[]>([]);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [total, setTotal] = useState(0);
  const [runsError, setRunsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [desc, setDesc] = useState("");
  const [descDirty, setDescDirty] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<AutopilotTrigger | null>(null);
  const seq = useRef(0);
  const descDirtyRef = useRef(false);

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    Promise.all([
      getAutopilot(autopilotId),
      listAutopilotRuns(autopilotId, { limit: 50 })
        .then((r) => ({ ok: true, runs: r.runs, total: r.total }))
        .catch(() => ({ ok: false, runs: [] as AutopilotRun[], total: 0 })),
    ])
      .then(([detail, runsResp]) => {
        if (my !== seq.current) return;
        setAutopilot(detail.autopilot);
        setTriggers(detail.triggers);
        setRuns(runsResp.runs);
        setTotal(runsResp.total);
        setRunsError(!runsResp.ok);
        // 保留用户未保存的任务说明草稿；否则以服务端值为准。
        if (!descDirtyRef.current) setDesc(detail.autopilot.description ?? "");
      })
      .catch(() => { if (my === seq.current) setAutopilot(null); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [autopilotId]);
  useEffect(reload, [reload]);
  useEffect(() => { listProjectOptions().then(setProjects).catch(() => setProjects([])); }, [autopilotId]);

  const back = () => WKApp.routeRight.pop();
  const mutated = () => { reload(); onChanged?.(); };

  const nextRun = useMemo(() => {
    const times = triggers
      .filter((tr) => tr.enabled && tr.next_run_at)
      .map((tr) => tr.next_run_at as string)
      .sort();
    return times[0] ?? null;
  }, [triggers]);

  const patchAutopilot = async (req: Parameters<typeof updateAutopilot>[1]) => {
    if (!autopilot) return;
    try { await updateAutopilot(autopilot.id, req); Toast.success(t("loop.toast.saved")); mutated(); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
  };

  const changeDesc = (v: string) => { setDesc(v); setDescDirty(true); descDirtyRef.current = true; };
  const saveDesc = async () => {
    if (!autopilot) return;
    setSavingDesc(true);
    try {
      await updateAutopilot(autopilot.id, { description: desc.trim() || null });
      setDescDirty(false); descDirtyRef.current = false;
      Toast.success(t("loop.toast.saved"));
      onChanged?.();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setSavingDesc(false);
    }
  };

  const changeAssignee = (id: string | null, type: AssigneeType | null) => {
    if (!id || (type !== "agent" && type !== "squad")) return;
    patchAutopilot({ assignee_type: type as AutopilotAssigneeType, assignee_id: id });
  };

  // 立即执行会真正触发一次运行，二次确认避免误触。
  const runNow = () => {
    if (!autopilot) return;
    Modal.confirm({
      title: t("loop.automation.runNowConfirm"),
      content: t("loop.automation.runNowConfirmDesc"),
      okText: t("loop.automation.runNow"),
      cancelText: t("loop.action.cancel"),
      centered: true,
      onOk: async () => {
        try { await triggerAutopilot(autopilot.id); Toast.success(t("loop.automation.runStarted")); reload(); }
        catch (e) { Toast.error((e as Error)?.message ?? t("loop.automation.runFailed")); }
      },
    });
  };

  const removeAutopilot = () => {
    if (!autopilot) return;
    confirmDelete({
      title: t("loop.automation.confirmDelete"),
      content: autopilot.title,
      okText: t("loop.action.delete"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try { await deleteAutopilot(autopilot.id); Toast.success(t("loop.toast.deleted")); onChanged?.(); back(); }
        catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.deleteFailed")); }
      },
    });
  };

  const toggleTrigger = async (tr: AutopilotTrigger, on: boolean) => {
    try { await updateAutopilotTrigger(autopilotId, tr.id, { enabled: on }); Toast.success(t("loop.toast.saved")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
  };
  const removeTrigger = (tr: AutopilotTrigger) => confirmDelete({
    title: t("loop.automation.confirmDeleteTrigger"),
    okText: t("loop.action.delete"),
    cancelText: t("loop.action.cancel"),
    onOk: async () => {
      try { await deleteAutopilotTrigger(autopilotId, tr.id); Toast.success(t("loop.toast.deleted")); reload(); }
      catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.deleteFailed")); }
    },
  });
  const openAddTrigger = () => { setEditingTrigger(null); setTriggerOpen(true); };
  const openEditTrigger = (tr: AutopilotTrigger) => { setEditingTrigger(tr); setTriggerOpen(true); };

  const openIssue = (issueId: string) =>
    WKApp.routeRight.push(<IssueDetailPage key={issueId} issueId={issueId} onChanged={reload} />);

  if (loading && !autopilot) return <div className="loop-apd"><div className="loop-sd__center"><Spin /></div></div>;
  if (!autopilot) return (
    <div className="loop-apd">
      <div className="loop-sd__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div>
    </div>
  );

  const paused = autopilot.status === "paused";

  return (
    <div className="loop-apd">
      <div className="loop-apd__header">
        <button className="loop-apd__crumb" onClick={back}>{t("loop.nav.automation")}</button>
        <ChevronRight size={13} className="loop-apd__crumb-sep" />
        <span className="loop-apd__crumb-cur">{autopilot.title}</span>
        <div className="loop-apd__header-spacer" />
        <Switch checked={!paused} size="small" onChange={(on) => patchAutopilot({ status: on ? "active" : "paused" })} disabled={autopilot.status === "archived"} />
        <LoopTag tone={STATUS_TAG[autopilot.status]}>{t(`loop.automation.statusLabel.${autopilot.status}`)}</LoopTag>
      </div>

      <div className="loop-apd__body">
        <section className="loop-apd__main">
          {/* 任务说明：技能编辑器风格（borderless 卡片 + autosize）+ 右上角保存 */}
          <div className="loop-apd__block">
            <div className="loop-apd__block-head">
              <span className="loop-apd__block-title">{t("loop.automation.taskDesc")}</span>
              <LoopButton size="sm" icon={<Save size={14} />} disabled={!descDirty} loading={savingDesc} onClick={saveDesc}>
                {t("loop.action.save")}
              </LoopButton>
            </div>
            <AutoGrowTextarea
              className="loop-field-textarea loop-field-textarea--lg loop-field-textarea--auto"
              value={desc}
              onChange={changeDesc}
              placeholder={t("loop.automation.taskDescTemplate")}
              spellCheck={false}
            />
          </div>

          {/* 触发器 */}
          <div className="loop-apd__block">
            <div className="loop-apd__block-head">
              <span className="loop-apd__block-title">{t("loop.automation.triggers")}</span>
              <Button theme="borderless" size="small" icon={<Plus size={14} />} onClick={openAddTrigger}>{t("loop.automation.addTrigger")}</Button>
            </div>
            {triggers.length === 0 ? (
              <Text type="tertiary" size="small">{t("loop.automation.noTriggers")}</Text>
            ) : (
              <div className="loop-apd__triggers">
                {triggers.map((tr) => {
                  const cfg = parseCron(tr.cron_expression, tr.timezone ?? "");
                  return (
                    <div key={tr.id} className="loop-apd__trigger">
                      <Clock size={15} className="loop-apd__trigger-ico" />
                      <div className="loop-apd__trigger-main">
                        <span className="loop-apd__trigger-summary">{describeSchedule(cfg, t)}</span>
                        <span className="loop-apd__trigger-sub">
                          {tr.timezone ? `${tr.timezone} · ` : ""}{t("loop.automation.nextRun")} {formatNextRunAt(tr.next_run_at) || "—"}
                        </span>
                      </div>
                      <Switch size="small" checked={tr.enabled} onChange={(v) => toggleTrigger(tr, v)} />
                      <Button theme="borderless" size="small" icon={<Pencil size={14} />} onClick={() => openEditTrigger(tr)} />
                      <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => removeTrigger(tr)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 运行历史 */}
          <div className="loop-apd__block">
            <div className="loop-apd__block-head">
              <span className="loop-apd__block-title">{t("loop.automation.runHistory")}</span>
              <Text type="tertiary" size="small">{total}</Text>
            </div>
            {runsError ? (
              <div className="loop-apd__runs-error">
                <Text type="tertiary" size="small">{t("loop.automation.runsError")}</Text>
                <Button theme="borderless" size="small" onClick={reload}>{t("loop.automation.retry")}</Button>
              </div>
            ) : runs.length === 0 ? (
              <Text type="tertiary" size="small">{t("loop.automation.noRuns")}</Text>
            ) : (
              <div className="loop-apd__runs">
                {runs.map((r) => {
                  const color = AUTOPILOT_RUN_DOT[r.status] ?? AUTOPILOT_RUN_DOT_FALLBACK;
                  const dur = r.completed_at ? formatDurationMs(Date.parse(r.completed_at) - Date.parse(r.triggered_at)) : "—";
                  const clickable = !!r.issue_id;
                  return (
                    <div
                      key={r.id}
                      className={`loop-apd__run${clickable ? " is-clickable" : ""}`}
                      onClick={clickable ? () => openIssue(r.issue_id as string) : undefined}
                      title={clickable ? t("loop.automation.viewIssue") : undefined}
                    >
                      <i className="loop-apd__run-dot" style={{ background: color }} />
                      <span className="loop-apd__run-status">{t(`loop.automation.runStatus.${r.status}`)}</span>
                      <span className="loop-apd__run-source">{t(`loop.automation.runSource.${r.source}`)}</span>
                      {autopilot.project_name && <span className="loop-apd__run-target">· {autopilot.project_name}</span>}
                      <span className="loop-apd__run-spacer" />
                      <span className="loop-apd__run-dur">{dur}</span>
                      <span className="loop-apd__run-time">{formatRelativeTime(r.triggered_at, format)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="loop-apd__aside">
          <div className="loop-apd__prop">
            <div className="loop-apd__prop-label">{t("loop.field.name")}</div>
            <div className="loop-apd__prop-value">
              <InlineName value={autopilot.title} onSave={(v) => patchAutopilot({ title: v })} />
            </div>
          </div>
          <div className="loop-apd__prop">
            <div className="loop-apd__prop-label">{t("loop.field.status")}</div>
            <div className="loop-apd__prop-value">
              <i className="loop-apd__status-dot" data-status={autopilot.status} />
              {t(`loop.automation.statusLabel.${autopilot.status}`)}
            </div>
          </div>
          <div className="loop-apd__prop">
            <div className="loop-apd__prop-label">{t("loop.automation.executor")}</div>
            <div className="loop-apd__prop-value">
              <AssigneePicker
                value={autopilot.assignee_id}
                valueName={autopilot.assignee_name ?? null}
                types={["agent", "squad"]}
                onChange={changeAssignee}
              />
            </div>
          </div>
          <div className="loop-apd__prop">
            <div className="loop-apd__prop-label">{t("loop.automation.sendTo")}</div>
            <Select
              value={autopilot.project_id ?? undefined}
              onChange={(v) => patchAutopilot({ project_id: (v as string) ?? null })}
              placeholder={t("loop.automation.sendToPlaceholder")}
              dropdownClassName="loop-fields__dropdown"
              showClear
              filter
              style={{ width: "100%" }}
            >
              {projects.map((p) => (
                <Select.Option key={p.id} value={p.id}>{p.title}</Select.Option>
              ))}
            </Select>
          </div>
          <div className="loop-apd__prop">
            <div className="loop-apd__prop-label">{t("loop.automation.nextRun")}</div>
            <div className="loop-apd__prop-value">{formatNextRunAt(nextRun) || "—"}</div>
          </div>
          <div className="loop-apd__actions">
            <LoopButton block icon={<Play size={14} />} disabled={autopilot.status !== "active"} onClick={runNow}>{t("loop.automation.runNow")}</LoopButton>
            <Button block type="danger" theme="borderless" icon={<Trash2 size={14} />} onClick={removeAutopilot}>{t("loop.action.delete")}</Button>
          </div>
        </aside>
      </div>

      <TriggerEditModal
        visible={triggerOpen}
        autopilotId={autopilotId}
        trigger={editingTrigger}
        onClose={() => { setTriggerOpen(false); setEditingTrigger(null); }}
        onSaved={reload}
      />
    </div>
  );
}
