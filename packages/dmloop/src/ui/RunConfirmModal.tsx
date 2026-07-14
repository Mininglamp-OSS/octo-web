import React, { useEffect, useState } from "react";
import { Modal, Button, TextArea, Spin, Typography, Toast } from "@douyinfe/semi-ui";
import LoopButton from "./LoopButton";
import { useI18n } from "@octo/base";
import type { AssigneeType, IssueStatus, Issue } from "../api/types";
import { previewIssueTrigger } from "../api/issueApi";

const { Text } = Typography;

/** 一次指派/状态变更请求：apply 由调用方给出（真正落库的 updateIssue 调用）。
 *  hook 内部类型——调用方走 requestAssign / requestStatus,不直接构造。 */
interface RunConfirmRequest {
  issueId: string;
  status: IssueStatus;
  assigneeType: AssigneeType | null;
  assigneeId: string | null;
  assigneeName: string | null;
  apply: (extra: { suppress_run?: boolean; handoff_note?: string }) => void | Promise<void>;
}

// 该 actor 是否是会执行的 agent/squad(而非 member/未指派)。
function isAgentAssignee(type: AssigneeType | null, id: string | null): boolean {
  return (type === "agent" || type === "squad") && !!id;
}

// 是否需要“派单预确认”：与产品设计一致——agent/squad 指派且 issue 非 backlog。
function needsConfirm(r: RunConfirmRequest): boolean {
  return isAgentAssignee(r.assigneeType, r.assigneeId) && r.status !== "backlog";
}

// 状态变更是否会触发 run(与后端 WillEnqueueRun status 源一致):
// agent/squad 已指派,且从 backlog 移到非 backlog/done/cancelled。
// ponytail: 这是**客户端尽力判断**,用的是本地缓存的 assignee;真正是否起 run 由 preview-trigger
// 权威判定。并发场景(他人刚改派为 agent、本地视图未刷新)下本判断可能漏判 → 跳过确认弹窗,
// 但后端仍按持久 assignee 正确起 run(只是少了一次确认 UX)。沿用同一套客户端预确认 gate。
function statusMightTrigger(issue: Issue, next: IssueStatus): boolean {
  return (
    isAgentAssignee(issue.assignee_type, issue.assignee_id) &&
    issue.status === "backlog" &&
    next !== "backlog" && next !== "done" && next !== "cancelled"
  );
}

/**
 * 指派即触发的预确认 hook。用法：
 *   const { requestAssign, requestStatus, runConfirmModal } = useRunConfirm();
 *   <AssigneePicker onChange={(id,type,name)=>requestAssign(issue,type,id,name,(extra)=>patch({assignee_id:id,assignee_type:type,...extra}))}/>
 *   {runConfirmModal}
 * 不需确认（member/取消指派/backlog）直接 apply；需确认则弹窗，先 preview-trigger 问后端。
 */
export function useRunConfirm() {
  const { t } = useI18n();
  const [pending, setPending] = useState<RunConfirmRequest | null>(null);

  const applyDirect = (apply: RunConfirmRequest["apply"]) => {
    // 直接落库路径：失败要给反馈,别静默吞错。
    Promise.resolve(apply({})).catch((e) => Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")));
  };

  // 指派 actor：status 保持 issue 当前值(指派不改状态),请求对象在此组装,
  // 与 requestStatus 同构——调用方只给 issue + 新 assignee + apply。
  const requestAssign = (
    issue: Issue,
    assigneeType: AssigneeType | null,
    assigneeId: string | null,
    assigneeName: string | null,
    apply: RunConfirmRequest["apply"],
  ) => {
    const r: RunConfirmRequest = {
      issueId: issue.id,
      status: issue.status,
      assigneeType,
      assigneeId,
      assigneeName,
      apply,
    };
    if (!needsConfirm(r)) { applyDirect(apply); return; }
    setPending(r);
  };

  // 状态变更:仅在 backlog→活跃且已指派 agent/squad(会静默起 run)时弹确认;
  // preview 传当前 assignee(不变)+ 新 status,后端按 status 源判定。
  const requestStatus = (
    issue: Issue,
    next: IssueStatus,
    apply: RunConfirmRequest["apply"],
  ) => {
    if (!statusMightTrigger(issue, next)) { applyDirect(apply); return; }
    setPending({
      issueId: issue.id,
      status: next,
      assigneeType: issue.assignee_type,
      assigneeId: issue.assignee_id,
      assigneeName: issue.assignee_name ?? null,
      apply,
    });
  };

  const runConfirmModal = <RunConfirmModal pending={pending} onClose={() => setPending(null)} />;
  return { requestAssign, requestStatus, runConfirmModal };
}

function RunConfirmModal({ pending, onClose }: { pending: RunConfirmRequest | null; onClose: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [willStart, setWillStart] = useState(false);
  const [handoffSupported, setHandoffSupported] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errored, setErrored] = useState(false); // 预览失败:无法确定,按“会起 run”处理(fail-safe)

  useEffect(() => {
    if (!pending) return;
    let cancelled = false; // 切换 issue 时丢弃过期预览响应,防串台
    setNote("");
    setSubmitting(false);
    setErrored(false);
    setLoading(true);
    previewIssueTrigger({
      issue_ids: [pending.issueId],
      assignee_type: pending.assigneeType,
      assignee_id: pending.assigneeId,
      status: pending.status,
    })
      .then((p) => {
        if (cancelled) return;
        // 后端保证不起 run 的 issue 直接缺席 → total_count == triggers.length;用单一来源判定。
        const starts = p.triggers.length > 0;
        setWillStart(starts);
        setHandoffSupported(starts && p.triggers.every((x) => x.handoff_supported));
      })
      .catch(() => {
        if (cancelled) return;
        // fail-safe:预览拿不到就当“会起 run”,给出 suppress/开始 选项,绝不静默派单。
        setErrored(true);
        setWillStart(true);
        setHandoffSupported(false);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pending]);

  const run = async (extra: { suppress_run?: boolean; handoff_note?: string }) => {
    if (!pending) return;
    setSubmitting(true);
    try {
      await pending.apply(extra);
      onClose();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
      setSubmitting(false);
    }
  };

  const footer = loading ? null : willStart ? (
    <>
      <Button theme="borderless" disabled={submitting} onClick={() => run({ suppress_run: true })}>
        {t("loop.run.suppress")}
      </Button>
      <LoopButton loading={submitting} onClick={() => run({ handoff_note: note.trim() || undefined })}>
        {t("loop.run.start")}
      </LoopButton>
    </>
  ) : (
    <LoopButton loading={submitting} onClick={() => run({})}>
      {t("loop.run.apply")}
    </LoopButton>
  );

  return (
    <Modal
      className="loop-modal"
      title={t("loop.run.confirmTitle")}
      visible={!!pending}
      onCancel={onClose}
      maskClosable={!submitting}
      footer={footer}
      width={420}
    >
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
      ) : willStart ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {errored && <Text type="warning" size="small">{t("loop.run.previewFailed")}</Text>}
          <Text>{t("loop.run.willStart", { values: { name: pending?.assigneeName ?? "" } })}</Text>
          <TextArea
            value={note}
            onChange={setNote}
            disabled={!handoffSupported}
            maxCount={2000}
            autosize={{ minRows: 2, maxRows: 6 }}
            placeholder={handoffSupported ? t("loop.run.handoffPlaceholder") : t("loop.run.handoffUnsupported")}
          />
        </div>
      ) : (
        <Text type="tertiary">{t("loop.run.nothing", { values: { name: pending?.assigneeName ?? "" } })}</Text>
      )}
    </Modal>
  );
}
