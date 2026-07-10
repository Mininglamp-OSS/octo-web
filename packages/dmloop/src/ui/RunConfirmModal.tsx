import React, { useEffect, useState } from "react";
import { Modal, Button, TextArea, Spin, Typography, Toast } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { AssigneeType, IssueStatus } from "../api/types";
import { previewIssueTrigger } from "../api/issueApi";

const { Text } = Typography;

/** 一次指派/状态变更请求：apply 由调用方给出（真正落库的 updateIssue 调用）。 */
export interface RunConfirmRequest {
  issueId: string;
  status: IssueStatus;
  assigneeType: AssigneeType | null;
  assigneeId: string | null;
  assigneeName: string | null;
  apply: (extra: { suppress_run?: boolean; handoff_note?: string }) => void | Promise<void>;
}

// 是否需要“派单预确认”：与 multica 一致——agent/squad 指派且 issue 非 backlog。
function needsConfirm(r: RunConfirmRequest): boolean {
  return (r.assigneeType === "agent" || r.assigneeType === "squad") && !!r.assigneeId && r.status !== "backlog";
}

/**
 * 指派即触发的预确认 hook。用法：
 *   const { requestAssign, runConfirmModal } = useRunConfirm();
 *   <AssigneePicker onChange={(id,type)=>requestAssign({...,apply:(extra)=>patch({assignee_id:id,assignee_type:type,...extra})})}/>
 *   {runConfirmModal}
 * 不需确认（member/取消指派/backlog）直接 apply；需确认则弹窗，先 preview-trigger 问后端。
 */
export function useRunConfirm() {
  const [pending, setPending] = useState<RunConfirmRequest | null>(null);

  const requestAssign = (r: RunConfirmRequest) => {
    if (!needsConfirm(r)) { void r.apply({}); return; }
    setPending(r);
  };

  const runConfirmModal = <RunConfirmModal pending={pending} onClose={() => setPending(null)} />;
  return { requestAssign, runConfirmModal };
}

function RunConfirmModal({ pending, onClose }: { pending: RunConfirmRequest | null; onClose: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [willStart, setWillStart] = useState(false);
  const [handoffSupported, setHandoffSupported] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!pending) return;
    setNote("");
    setSubmitting(false);
    setLoading(true);
    previewIssueTrigger({
      issue_ids: [pending.issueId],
      assignee_type: pending.assigneeType,
      assignee_id: pending.assigneeId,
      status: pending.status,
    })
      .then((p) => {
        // 后端保证不起 run 的 issue 直接缺席 → total_count == triggers.length;用单一来源判定。
        const starts = p.triggers.length > 0;
        setWillStart(starts);
        setHandoffSupported(starts && p.triggers.every((x) => x.handoff_supported));
      })
      .catch(() => { setWillStart(false); setHandoffSupported(false); })
      .finally(() => setLoading(false));
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
      <Button theme="solid" loading={submitting} onClick={() => run({ handoff_note: note.trim() || undefined })}>
        {t("loop.run.start")}
      </Button>
    </>
  ) : (
    <Button theme="solid" loading={submitting} onClick={() => run({})}>
      {t("loop.run.apply")}
    </Button>
  );

  return (
    <Modal
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
