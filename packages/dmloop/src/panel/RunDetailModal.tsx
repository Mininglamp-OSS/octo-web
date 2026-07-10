import React, { useEffect, useRef, useState } from "react";
import { Modal, Spin, Tag, Typography, Empty } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { TaskRun, RunMessage } from "../api/types";
import { listRunMessages, listRuns } from "../api/runsApi";
import { RUN_STATUS_COLOR, isActiveRun } from "../ui/meta";

const { Text } = Typography;

const POLL_MS = 2000;

function fmt(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function msgText(m: RunMessage): string {
  if (m.output) return m.output; // tool_result
  if (m.content) return m.content; // text / thinking / error
  if (m.input) return JSON.stringify(m.input, null, 2); // tool_use
  return "";
}

/** 执行详情弹窗：状态/时间/触发 + 消息流（run-messages）。 */
export default function RunDetailModal({
  run,
  visible,
  onClose,
}: {
  run: TaskRun | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<RunMessage[]>([]);
  const [liveRun, setLiveRun] = useState<TaskRun | null>(run); // 随轮询刷新的 run 状态(点击时快照会过时)
  const [loading, setLoading] = useState(false);
  const lastSeqRef = useRef(0);

  // 打开时全量拉;运行中的 run 则每 2s 用 ?since 增量轮询消息 + 刷新 run 状态,终态即停(dmloop 无 fleet WS,退化为轮询)。
  useEffect(() => {
    if (!visible || !run) { setMessages([]); setLiveRun(null); lastSeqRef.current = 0; return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    lastSeqRef.current = 0;
    setLiveRun(run);

    const apply = (batch: RunMessage[], incremental: boolean) => {
      if (batch.length) lastSeqRef.current = Math.max(lastSeqRef.current, ...batch.map((m) => m.seq));
      if (!incremental) { setMessages(batch); return; }
      if (!batch.length) return;
      // ponytail: dedup by seq——保险起见,防 ?since 若为闭区间(未从前端核实)时重复;严格排他时此过滤无副作用。
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.seq));
        return [...prev, ...batch.filter((m) => !seen.has(m.seq))];
      });
    };

    // 每轮:拉消息增量 + 刷新 run 状态;run 到终态则停止轮询。
    const poll = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await listRunMessages(run.id, lastSeqRef.current).then((b) => { if (!cancelled) apply(b ?? [], true); }).catch(() => {});
        let stillActive = true;
        try {
          const fresh = (await listRuns(run.issue_id)).find((r) => r.id === run.id);
          if (fresh && !cancelled) { setLiveRun(fresh); stillActive = isActiveRun(fresh.status); }
        } catch { /* 保持轮询 */ }
        if (!cancelled && stillActive) poll();
      }, POLL_MS);
    };

    setLoading(true);
    listRunMessages(run.id)
      .then((m) => { if (!cancelled) apply(m ?? [], false); })
      .catch(() => { if (!cancelled) setMessages([]); })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        if (isActiveRun(run.status)) poll();
      });

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [visible, run]);

  const shown = liveRun ?? run;

  return (
    <Modal
      title={t("loop.run.detailTitle")}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={720}
      bodyStyle={{ maxHeight: "70vh", overflow: "auto" }}
    >
      {!shown ? null : (
        <div className="loop-run-detail">
          <div className="loop-run-detail__head">
            <Tag color={RUN_STATUS_COLOR[shown.status] ?? "grey"}>{t(`loop.taskStatus.${shown.status}`)}</Tag>
            <span className="loop-run-detail__meta">
              <Text type="tertiary">{shown.agent_name ?? shown.agent_id ?? "—"}</Text>
              {shown.trigger_summary && <Text type="tertiary"> · {shown.trigger_summary}</Text>}
            </span>
          </div>
          <dl className="loop-run-detail__props">
            <dt>{t("loop.run.dispatched")}</dt><dd>{fmt(shown.dispatched_at)}</dd>
            <dt>{t("loop.run.started")}</dt><dd>{fmt(shown.started_at)}</dd>
            <dt>{t("loop.run.completed")}</dt><dd>{fmt(shown.completed_at)}</dd>
          </dl>

          {shown.result?.output && (
            <div className="loop-run-detail__section">
              <div className="loop-detail__section-title">{t("loop.run.result")}</div>
              <pre className="loop-run-detail__output">{shown.result.output}</pre>
            </div>
          )}

          <div className="loop-run-detail__section">
            <div className="loop-detail__section-title">{t("loop.run.messages")}</div>
            {loading ? (
              <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
            ) : messages.length === 0 ? (
              <Empty description={t("loop.run.noMessages")} />
            ) : (
              <div className="loop-run-msgs">
                {messages.map((m, i) => (
                  <div key={`${m.seq}-${i}`} className="loop-run-msg">
                    <div className="loop-run-msg__head">
                      <Tag size="small" color="blue">{m.type}</Tag>
                      {m.tool && <Text type="tertiary" style={{ fontSize: 12 }}>{m.tool}</Text>}
                      <time>{fmt(m.created_at)}</time>
                    </div>
                    <pre className="loop-run-msg__body">{msgText(m)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
