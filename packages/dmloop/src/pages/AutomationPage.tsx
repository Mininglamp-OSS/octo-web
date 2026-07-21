import React, { useCallback, useEffect, useRef, useState } from "react";
import { Typography, Button, Spin, Toast, Switch, Avatar, Dropdown } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { Zap, Plus, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Autopilot } from "../api/types";
import {
  listAutopilots,
  updateAutopilot,
  deleteAutopilot,
  triggerAutopilot,
} from "../api/autopilotApi";
import { avatarColor, AUTOPILOT_RUN_DOT, AUTOPILOT_RUN_DOT_FALLBACK } from "../ui/meta";
import { confirmDelete } from "../ui/confirmDelete";
import { formatNextRunAt } from "../ui/autopilotSchedule";
import CreateAutomationModal from "../ui/CreateAutomationModal";
import AutopilotDetailPage from "../panel/AutopilotDetailPage";

const { Text } = Typography;

export default function AutomationPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Autopilot[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    listAutopilots()
      .then((list) => { if (my === seq.current) setRows(list); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, []);
  useEffect(reload, [reload]);

  const openDetail = (a: Autopilot) =>
    WKApp.routeRight.push(<AutopilotDetailPage autopilotId={a.id} onChanged={reload} />);

  const toggleEnabled = async (a: Autopilot, on: boolean) => {
    try {
      await updateAutopilot(a.id, { status: on ? "active" : "paused" });
      reload();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };

  const runNow = async (a: Autopilot) => {
    try {
      await triggerAutopilot(a.id);
      Toast.success(t("loop.automation.runStarted"));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.automation.runFailed"));
    }
  };

  const remove = async (id: string) => {
    try { await deleteAutopilot(id); Toast.success(t("loop.toast.deleted")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.deleteFailed")); }
  };
  const confirmRemove = (a: Autopilot) => confirmDelete({
    title: t("loop.automation.confirmDelete"),
    content: a.title,
    okText: t("loop.action.delete"),
    cancelText: t("loop.action.cancel"),
    onOk: () => remove(a.id),
  });

  const cards = () => rows.map((a) => {
    const paused = a.status === "paused";
    const dotColor = a.last_run_status ? (AUTOPILOT_RUN_DOT[a.last_run_status] ?? AUTOPILOT_RUN_DOT_FALLBACK) : AUTOPILOT_RUN_DOT_FALLBACK;
    const nextRun = formatNextRunAt(a.next_run_at);
    return (
      <div key={a.id} className="loop-automation-card" role="listitem" onClick={() => openDetail(a)}>
        <div className="loop-automation-card__head">
          <strong className="loop-automation-card__title">{a.title}</strong>
          <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
            <Switch checked={!paused} size="small" onChange={(v) => toggleEnabled(a, v)} />
          </div>
        </div>
        {a.description && <div className="loop-automation-card__desc">{a.description}</div>}
        <div className="loop-automation-card__meta">
          {nextRun && <span>{nextRun}</span>}
          {paused && <span className="loop-automation-card__paused">{t("loop.automation.paused")}</span>}
        </div>
        <div className="loop-automation-card__foot">
          <span className="loop-automation-card__assignee">
            <Avatar size="extra-extra-small" shape="square" color={avatarColor(a.assignee_name ?? a.assignee_id)} src={a.assignee_avatar}>
              {(a.assignee_name ?? "?").slice(0, 1).toUpperCase()}
            </Avatar>
            <span className="loop-automation-card__assignee-name">{a.assignee_name ?? a.assignee_id}</span>
          </span>
          <span className="loop-automation-card__runs">
            <i className="loop-automation-card__dot" style={{ background: dotColor }} />
          </span>
        </div>
        <div className="loop-automation-card__more" onClick={(e) => e.stopPropagation()}>
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item icon={<Play size={13} />} onClick={() => runNow(a)}>{t("loop.automation.runNow")}</Dropdown.Item>
                <Dropdown.Item icon={<Trash2 size={13} />} type="danger" onClick={() => confirmRemove(a)}>{t("loop.action.delete")}</Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button theme="borderless" size="small" icon={<MoreHorizontal size={16} />} />
          </Dropdown>
        </div>
      </div>
    );
  });

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <h2 className="loop-page__title">{t("loop.nav.automation")}</h2>
        <Text type="tertiary" style={{ fontSize: 13 }}>{rows.length}</Text>
        <div className="loop-page__spacer" />
        <LoopButton icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t("loop.automation.create")}</LoopButton>
      </div>
      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center"><Spin /></div>
        ) : rows.length === 0 ? (
          <div className="loop-empty">
            <Zap size={40} className="loop-empty__icon" />
            <div className="loop-empty__title">{t("loop.automation.emptyTitle")}</div>
            <div className="loop-empty__desc">{t("loop.automation.emptyDesc")}</div>
            <LoopButton icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>{t("loop.automation.create")}</LoopButton>
          </div>
        ) : (
          <div className="loop-automation-cards" role="list">{cards()}</div>
        )}
      </div>
      <CreateAutomationModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={reload}
      />
    </div>
  );
}
