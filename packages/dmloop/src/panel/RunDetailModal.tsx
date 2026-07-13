import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Spin, Empty, Toast } from "@douyinfe/semi-ui";
import {
  Bot,
  Brain,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ChevronRight,
  Clock,
} from "lucide-react";
import { useI18n } from "@octo/base";
import type { TaskRun, RunMessage } from "../api/types";
import { listRunMessages, listRuns } from "../api/runsApi";
import { isActiveRun } from "../ui/meta";
import { formatDurationMs } from "../ui/time";

const POLL_MS = 2000;

type EventColor = "agent" | "thinking" | "tool" | "result" | "error";

function eventColor(m: RunMessage): EventColor {
  switch (m.type) {
    case "text": return "agent";
    case "thinking": return "thinking";
    case "tool_use": return "tool";
    case "tool_result": return "result";
    case "error": return "error";
    default: return "result";
  }
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  return parts.length <= 3 ? p : ".../" + parts.slice(-2).join("/");
}

function eventSummary(m: RunMessage): string {
  switch (m.type) {
    case "text": return m.content?.split("\n").find((l) => l.trim().length > 0) ?? "";
    case "thinking": return m.content?.slice(0, 200) ?? "";
    case "tool_use": {
      const inp = (m.input ?? {}) as Record<string, unknown>;
      const pick = inp.query ?? inp.file_path ?? inp.path ?? inp.pattern ?? inp.description ?? inp.command ?? inp.prompt ?? inp.skill;
      if (typeof pick === "string") {
        const s = inp.file_path || inp.path ? shortenPath(pick) : pick;
        return s.length > 140 ? s.slice(0, 140) + "…" : s;
      }
      return "";
    }
    case "tool_result": return m.output?.slice(0, 200) ?? "";
    case "error": return m.content ?? "";
    default: return "";
  }
}

function eventDetail(m: RunMessage): string {
  if (m.type === "tool_use") return m.input ? JSON.stringify(m.input, null, 2) : "";
  if (m.type === "tool_result") {
    const o = m.output ?? "";
    return o.length > 4000 ? o.slice(0, 4000) + "\n… (truncated)" : o;
  }
  return m.content ?? "";
}

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** 单个事件行：类型徽标 + 摘要 + 序号/时间 + 可展开详情。 */
function TranscriptRow({ m, label }: { m: RunMessage; label: string }) {
  const [open, setOpen] = useState(false);
  const color = eventColor(m);
  const summary = eventSummary(m);
  const detail = eventDetail(m);
  const hasDetail = detail.length > 0;
  return (
    <div className={`loop-tr__row loop-tr__row--${color}`}>
      <button type="button" className="loop-tr__line" disabled={!hasDetail} onClick={() => setOpen((o) => !o)}>
        <span className={`loop-tr__badge loop-tr__badge--${color}`}>
          {m.type === "thinking" && <Brain size={11} />}
          {m.type === "error" && <AlertCircle size={11} />}
          {label}
        </span>
        <span className="loop-tr__summary">
          {hasDetail && <ChevronRight size={12} className={`loop-tr__chevron${open ? " is-open" : ""}`} />}
          <span className="loop-tr__summary-text">{summary || "—"}</span>
        </span>
        <span className="loop-tr__seq">#{m.seq}</span>
        {m.created_at && <time className="loop-tr__time">{fmtTime(m.created_at)}</time>}
      </button>
      {open && hasDetail && (
        <pre className="loop-tr__detail">{detail}</pre>
      )}
    </div>
  );
}

/** 时间线进度条：按连续同色分段，点击滚动到对应事件（简化为纯展示）。 */
function TimelineBar({ messages }: { messages: RunMessage[] }) {
  const segments = useMemo(() => {
    const segs: { color: EventColor; count: number }[] = [];
    let cur: EventColor | null = null;
    for (const m of messages) {
      const c = eventColor(m);
      if (c !== cur) { segs.push({ color: c, count: 1 }); cur = c; }
      else segs[segs.length - 1].count += 1;
    }
    return segs;
  }, [messages]);
  const total = messages.length || 1;
  return (
    <div className="loop-tr__bar">
      {segments.map((s, i) => (
        <span
          key={i}
          className={`loop-tr__bar-seg loop-tr__bar-seg--${s.color}`}
          style={{ width: `${Math.max((s.count / total) * 100, 0.5)}%` }}
        />
      ))}
    </div>
  );
}

/** 执行详情弹窗：转写体验（对齐产品设计）——状态/时长 + 时间线 + 可展开事件流。 */
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
  const [liveRun, setLiveRun] = useState<TaskRun | null>(run);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // run 连续 miss 达阈值判定"已消失"——与终态停轮询区分:终态是 run 仍在、只是跑完了;
  // gone 是 run 从列表里没了(被删/清理),此时不能静默冻在陈旧的 running,要给用户提示。
  const [gone, setGone] = useState(false);
  const lastSeqRef = useRef(0);
  // listRuns 内部吞掉 task-runs 的 HTTP 失败返回 []([] 既可能是"run 消失"也可能是"瞬时网络失败",
  // 无法区分)。连续 miss 计数:容忍偶发 [](下轮即恢复),连续多次才判定 run 真消失并停轮询——
  // 既修原「run 消失后无限轮询」,又不因一次网络抖动误停仍在跑的 run。
  const missRef = useRef(0);
  const MAX_MISSES = 3;

  // 打开时全量拉;运行中的 run 则每 2s 增量轮询 + 刷新状态,终态即停(无 WS,退化轮询)。
  useEffect(() => {
    if (!visible || !run) { setMessages([]); setLiveRun(null); lastSeqRef.current = 0; missRef.current = 0; setGone(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    lastSeqRef.current = 0;
    missRef.current = 0;
    setGone(false);
    setLiveRun(run);

    const apply = (batch: RunMessage[], incremental: boolean) => {
      if (batch.length) lastSeqRef.current = Math.max(lastSeqRef.current, ...batch.map((m) => m.seq));
      if (!incremental) { setMessages(batch); return; }
      if (!batch.length) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.seq));
        return [...prev, ...batch.filter((m) => !seen.has(m.seq))];
      });
    };

    const poll = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await listRunMessages(run.id, lastSeqRef.current).then((b) => { if (!cancelled) apply(b ?? [], true); }).catch(() => {});
        let stillActive = true;
        try {
          const fresh = (await listRuns(run.issue_id)).find((r) => r.id === run.id);
          if (cancelled) return;
          if (fresh) { setLiveRun(fresh); stillActive = isActiveRun(fresh.status); missRef.current = 0; }
          else { missRef.current += 1; stillActive = missRef.current < MAX_MISSES; if (!stillActive) setGone(true); } // 连续 miss 达阈值:判定 run 已消失,停轮询并提示
        } catch { /* ensureDirectory 等抛错:保持轮询 */ }
        if (!cancelled && stillActive) poll();
        // 终止前再做一次增量抓取:run 完成时的最后一批消息(result/error)常在上面抓取返回后、
        // status 翻转前才写入,不补一次会永久丢失最关键的收尾消息(#610 评审)。
        else if (!cancelled) await listRunMessages(run.id, lastSeqRef.current).then((b) => { if (!cancelled) apply(b ?? [], true); }).catch(() => {});
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
  const active = shown ? isActiveRun(shown.status) : false;

  const eventLabel = (m: RunMessage): string => {
    if ((m.type === "tool_use" || m.type === "tool_result") && m.tool) return m.tool;
    if (m.type === "text") return t("loop.run.event.text");
    if (m.type === "thinking") return t("loop.run.event.thinking");
    if (m.type === "tool_use") return t("loop.run.event.tool");
    if (m.type === "tool_result") return t("loop.run.event.result");
    if (m.type === "error") return t("loop.run.event.error");
    return m.type;
  };

  const toolCount = messages.filter((m) => m.type === "tool_use").length;
  const duration = shown?.started_at && shown?.completed_at
    ? formatDurationMs(new Date(shown.completed_at).getTime() - new Date(shown.started_at).getTime())
    : null;

  const copyAll = () => {
    const text = messages.map((m) => `[${eventLabel(m)}] ${eventSummary(m)}`).join("\n");
    navigator.clipboard?.writeText(text)?.then(() => {
      setCopied(true);
      Toast.success(t("loop.run.copied"));
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const statusBadge = !shown ? null : gone ? (
    <span className="loop-tr__status loop-tr__status--fail"><XCircle size={12} />{t("loop.run.gone")}</span>
  ) : active ? (
    <span className="loop-tr__status loop-tr__status--running"><Loader2 size={12} className="loop-spin" />{t("loop.taskStatus.running")}</span>
  ) : shown.status === "completed" ? (
    <span className="loop-tr__status loop-tr__status--ok"><CheckCircle2 size={12} />{t("loop.taskStatus.completed")}</span>
  ) : shown.status === "failed" ? (
    <span className="loop-tr__status loop-tr__status--fail"><XCircle size={12} />{t("loop.taskStatus.failed")}</span>
  ) : (
    <span className="loop-tr__status">{t(`loop.taskStatus.${shown.status}`)}</span>
  );

  const header = (
    <div className="loop-tr__head">
      <span className="loop-tr__agent"><Bot size={15} />{shown?.agent_name ?? shown?.agent_id ?? "—"}</span>
      {statusBadge}
      <button type="button" className="loop-tr__copy" onClick={copyAll}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? t("loop.run.copied") : t("loop.run.copyAll")}
      </button>
    </div>
  );

  return (
    <Modal
      className="loop-modal loop-tr-modal"
      title={header}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={880}
      bodyStyle={{ maxHeight: "72vh", overflow: "auto", padding: 0 }}
    >
      {!shown ? null : (
        <div className="loop-tr">
          <div className="loop-tr__chips">
            {shown.trigger_summary && <span className="loop-tr__chip">{shown.trigger_summary}</span>}
            {duration && <span className="loop-tr__chip"><Clock size={12} />{duration}</span>}
            {toolCount > 0 && <span className="loop-tr__chip">{t("loop.run.toolCalls", { values: { count: toolCount } })}</span>}
            <span className="loop-tr__chip">{t("loop.run.events", { values: { count: messages.length } })}</span>
          </div>

          {messages.length > 0 && <TimelineBar messages={messages} />}

          {shown.result?.output && (
            <pre className="loop-tr__result">{shown.result.output}</pre>
          )}

          <div className="loop-tr__list">
            {loading ? (
              <div className="loop-tr__center"><Spin /></div>
            ) : messages.length === 0 ? (
              <div className="loop-tr__center">
                {active ? (
                  <span className="loop-tr__waiting"><Loader2 size={14} className="loop-spin" />{t("loop.run.waiting")}</span>
                ) : (
                  <Empty description={t("loop.run.noData")} />
                )}
              </div>
            ) : (
              messages.map((m, i) => <TranscriptRow key={`${m.seq}-${i}`} m={m} label={eventLabel(m)} />)
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
