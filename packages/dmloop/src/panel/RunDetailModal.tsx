import React, { useEffect, useState } from "react";
import { Modal, Spin, Tag, Typography, Empty } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { TaskRun, RunMessage } from "../api/types";
import { listRunMessages } from "../api/runsApi";
import { RUN_STATUS_COLOR } from "../ui/meta";

const { Text } = Typography;

function fmt(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function msgText(m: RunMessage): string {
  if (m.text) return m.text;
  if (typeof m.content === "string") return m.content;
  if (m.input) return typeof m.input === "string" ? m.input : JSON.stringify(m.input, null, 2);
  if (m.content) return JSON.stringify(m.content, null, 2);
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !run) return;
    setLoading(true);
    listRunMessages(run.id)
      .then((m) => setMessages(m ?? []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [visible, run]);

  return (
    <Modal
      title={t("loop.run.detailTitle")}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={720}
      bodyStyle={{ maxHeight: "70vh", overflow: "auto" }}
    >
      {!run ? null : (
        <div className="loop-run-detail">
          <div className="loop-run-detail__head">
            <Tag color={RUN_STATUS_COLOR[run.status] ?? "grey"}>{t(`loop.taskStatus.${run.status}`)}</Tag>
            <span className="loop-run-detail__meta">
              <Text type="tertiary">{run.agent_name ?? run.agent_id ?? "—"}</Text>
              {run.trigger_summary && <Text type="tertiary"> · {run.trigger_summary}</Text>}
            </span>
          </div>
          <dl className="loop-run-detail__props">
            <dt>{t("loop.run.dispatched")}</dt><dd>{fmt(run.dispatched_at)}</dd>
            <dt>{t("loop.run.started")}</dt><dd>{fmt(run.started_at)}</dd>
            <dt>{t("loop.run.completed")}</dt><dd>{fmt(run.completed_at)}</dd>
          </dl>

          {run.result?.output && (
            <div className="loop-run-detail__section">
              <div className="loop-detail__section-title">{t("loop.run.result")}</div>
              <pre className="loop-run-detail__output">{run.result.output}</pre>
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
