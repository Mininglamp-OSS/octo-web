import React, { useEffect, useState } from "react";
import { Modal, Toast, Avatar } from "@douyinfe/semi-ui";
import { ChevronRight, X, Paperclip } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueStatus, IssuePriority, AssigneeType } from "../api/types";
import { createIssue, listAssigneeCandidates } from "../api/issueApi";
import { listProjectOptions } from "../api/directory";
import { uploadAttachment } from "../api/attachmentApi";
import { currentWorkspaceName } from "../api/http";
import AssigneePicker from "./AssigneePicker";
import AutoGrowTextarea from "./AutoGrowTextarea";
import LoopButton from "./LoopButton";
import LoopPropertyPill, { type LoopPropertyPillOption } from "./LoopPropertyPill";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_ICON,
  ISSUE_STATUS_HEX,
  PRIORITY_ORDER,
  PRIORITY_ICON,
  PRIORITY_HEX,
} from "./meta";

export interface CreateIssueModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /** 传入即新建为该 issue 的子任务(绑定 parent_issue_id)。 */
  parentIssueId?: string;
}

// 上次选中的指派对象(仅 new loop 场景):sessionStorage 记忆,下次开框若仍是有效候选则复用。
const LAST_ASSIGNEE_KEY = "loop.newloop.assignee";
type LastAssignee = { id: string; type: AssigneeType; name: string };
function readLastAssignee(): LastAssignee | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(LAST_ASSIGNEE_KEY) ?? "null");
    if (p && typeof p.id === "string" && typeof p.type === "string" && typeof p.name === "string") return p;
  } catch { /* ignore */ }
  return null;
}
function writeLastAssignee(a: LastAssignee): void {
  try { sessionStorage.setItem(LAST_ASSIGNEE_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

/**
 * 新建回路弹窗(对齐 multica 手动建单):面包屑([workspace] > 新建回路) + 标题 + 描述 +
 * 运行提示(选了 AI 队友时提示「创建后 X 会立即开始工作」) + pill 工具栏(状态/优先级/指派) +
 * 底栏(左附件 · 右取消/创建)。指派默认落到「我的第一个 AI队友」,并记忆上次选择。
 * 传 parentIssueId 时创建为子任务。
 */
export default function CreateIssueModal({ visible, onClose, onCreated, parentIssueId }: CreateIssueModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [projectId, setProjectId] = useState<string>("");
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeType, setAssigneeType] = useState<AssigneeType | null>(null);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(""); setDesc(""); setStatus("todo"); setPriority("none"); setProjectId(""); setPendingFiles([]);
    setAssigneeId(null); setAssigneeType(null); setAssigneeName(null);
    let alive = true;
    listProjectOptions().then((ps) => { if (alive) setProjects(ps); }).catch(() => { if (alive) setProjects([]); });
    // 默认指派:优先复用上次选择(若仍是有效候选),否则落到我的第一个 AI队友(agent)。
    listAssigneeCandidates()
      .then((cands) => {
        if (!alive) return;
        const last = readLastAssignee();
        const reuse = last ? cands.find((c) => c.id === last.id) : undefined;
        const pick = reuse ?? cands.find((c) => c.type === "agent") ?? null;
        if (pick) { setAssigneeId(pick.id); setAssigneeType(pick.type); setAssigneeName(pick.name); }
      })
      .catch(() => { /* 无候选则保持未指派 */ });
    return () => { alive = false; };
  }, [visible]);

  const isBot = assigneeType === "agent" || assigneeType === "squad";

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    setPendingFiles((p) => [...p, ...arr]);
  };
  const removeFile = (idx: number) => setPendingFiles((p) => p.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      // 附件先上传拿 id(issue 尚不存在),再随建单绑定;任一失败则中止建单,提示重试。
      let attachmentIds: string[] | undefined;
      if (pendingFiles.length) {
        const ids: string[] = [];
        let failed = 0;
        for (const f of pendingFiles) {
          try { ids.push((await uploadAttachment(f)).id); } catch { failed++; }
        }
        if (failed) { Toast.error(t("loop.attach.attachFailed", { values: { count: failed } })); return; }
        if (ids.length) attachmentIds = ids;
      }
      await createIssue({
        title: title.trim(),
        description: desc || undefined,
        status,
        priority,
        assignee_id: assigneeId,
        assignee_type: assigneeType,
        project_id: projectId || null,
        parent_issue_id: parentIssueId,
        attachment_ids: attachmentIds,
      });
      // 记忆本次 AI 队友选择(仅 agent/squad),下次 new loop 复用。
      if (isBot && assigneeId && assigneeType && assigneeName) {
        writeLastAssignee({ id: assigneeId, type: assigneeType, name: assigneeName });
      }
      onClose();
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  };

  const statusOptions: LoopPropertyPillOption<IssueStatus>[] = ISSUE_STATUS_ORDER.map((s) => {
    const Icon = ISSUE_STATUS_ICON[s];
    return { value: s, label: t(`loop.status.${s}`), icon: <Icon size={14} style={{ color: ISSUE_STATUS_HEX[s] }} /> };
  });
  const priorityOptions: LoopPropertyPillOption<IssuePriority>[] = PRIORITY_ORDER.map((p) => {
    const Icon = PRIORITY_ICON[p];
    return { value: p, label: t(`loop.priority.${p}`), icon: <Icon size={14} style={{ color: PRIORITY_HEX[p] }} /> };
  });
  const projectOptions: LoopPropertyPillOption<string>[] = [
    { value: "", label: t("loop.field.noProject") },
    ...projects.map((p) => ({ value: p.id, label: p.title })),
  ];

  const wsName = currentWorkspaceName();

  return (
    <Modal
      className="loop-modal loop-ci-modal"
      visible={visible}
      onCancel={onClose}
      header={null}
      footer={null}
      closable={false}
      width={600}
    >
      <div className="loop-ci">
        <div className="loop-ci__head">
          <div className="loop-ci__crumb">
            {wsName && (
              <>
                <span className="loop-ci__crumb-ws">{wsName}</span>
                <ChevronRight size={13} className="loop-ci__crumb-sep" />
              </>
            )}
            <span className="loop-ci__crumb-cur">{parentIssueId ? t("loop.subIssue.create") : t("loop.action.newIssue")}</span>
          </div>
          <button type="button" className="loop-ci__close" onClick={onClose} aria-label={t("loop.action.cancel")}>
            <X size={16} />
          </button>
        </div>

        <input
          autoFocus
          className="loop-ci__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("loop.field.titlePlaceholder")}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <AutoGrowTextarea
          className="loop-ci__desc"
          value={desc}
          onChange={setDesc}
          placeholder={t("loop.field.descriptionPlaceholder")}
        />

        {isBot && assigneeName && (
          <div className="loop-ci__hint">
            <Avatar size="extra-extra-small" color="light-blue">{assigneeName.slice(0, 1)}</Avatar>
            <span>{t("loop.createIssue.runHint", { values: { name: assigneeName } })}</span>
          </div>
        )}

        <div className="loop-ci__toolbar">
          <LoopPropertyPill value={status} options={statusOptions} onChange={setStatus} ariaLabel={t("loop.field.status")} />
          <LoopPropertyPill value={priority} options={priorityOptions} onChange={setPriority} ariaLabel={t("loop.field.priority")} />
          <AssigneePicker
            value={assigneeId}
            valueName={assigneeName}
            onChange={(id, type, name) => { setAssigneeId(id); setAssigneeType(type); setAssigneeName(name); }}
          />
          <LoopPropertyPill value={projectId} options={projectOptions} onChange={setProjectId} ariaLabel={t("loop.field.project")} />
        </div>

        {pendingFiles.length > 0 && (
          <div className="loop-ci__atts">
            {pendingFiles.map((f, i) => (
              <span key={i} className="loop-ci__att">
                <Paperclip size={12} />
                <span>{f.name}</span>
                <button type="button" aria-label={t("loop.action.delete")} onClick={() => removeFile(i)}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="loop-ci__footer">
          <label className="loop-ci__attach" aria-label={t("loop.attach.add")}>
            <Paperclip size={16} />
            <input type="file" multiple hidden disabled={submitting} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          <div className="loop-ci__footer-right">
            <LoopButton variant="ghost" onClick={onClose}>{t("loop.action.cancel")}</LoopButton>
            <LoopButton loading={submitting} disabled={!title.trim()} onClick={submit}>{t("loop.action.create")}</LoopButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
