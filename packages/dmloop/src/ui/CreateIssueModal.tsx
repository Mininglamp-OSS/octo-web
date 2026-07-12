import React, { useEffect, useState } from "react";
import { Modal, Select, Tag } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { IssueStatus, IssuePriority, Project } from "../api/types";
import { createIssue } from "../api/issueApi";
import { listProjects } from "../api/projectApi";
import AssigneePicker from "./AssigneePicker";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
} from "./meta";

export interface CreateIssueModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /** 传入即新建为该 issue 的子任务(绑定 parent_issue_id)。 */
  parentIssueId?: string;
}

/**
 * 新建 Issue 弹窗（对齐产品设计的手动创建流程）：
 * 标题 / 描述 / 指派(member|agent|squad 三态) / 状态 / 优先级 / 项目。
 * 传 parentIssueId 时创建为子任务。
 */
export default function CreateIssueModal({ visible, onClose, onCreated, parentIssueId }: CreateIssueModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeType, setAssigneeType] = useState<import("../api/types").AssigneeType | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(""); setDesc(""); setStatus("todo"); setPriority("none");
      setAssigneeId(null); setAssigneeType(null); setProjectId(null);
      listProjects().then(setProjects).catch(() => setProjects([]));
    }
  }, [visible]);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await createIssue({
        title: title.trim(),
        description: desc || undefined,
        status,
        priority,
        assignee_id: assigneeId,
        assignee_type: assigneeType,
        project_id: projectId,
        parent_issue_id: parentIssueId,
      });
      onClose();
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="loop-modal"
      title={parentIssueId ? t("loop.subIssue.create") : t("loop.action.newIssue")}
      visible={visible}
      onOk={submit}
      onCancel={onClose}
      okText={t("loop.action.create")}
      cancelText={t("loop.action.cancel")}
      okButtonProps={{ loading: submitting, disabled: !title.trim() }}
      width={560}
    >
      <div className="loop-createissue">
        <input
          autoFocus
          className="loop-field loop-field--lg"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("loop.field.titlePlaceholder")}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <textarea
          className="loop-field-textarea"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t("loop.field.descriptionPlaceholder")}
          style={{ marginTop: 12 }}
        />

        <div className="loop-createissue__row">
          <div className="loop-createissue__field">
            <label>{t("loop.field.status")}</label>
            <Select value={status} onChange={(v) => setStatus(v as IssueStatus)} dropdownClassName="loop-fields__dropdown" style={{ width: "100%" }} size="small">
              {ISSUE_STATUS_ORDER.map((s) => (
                <Select.Option key={s} value={s}>
                  <Tag color={ISSUE_STATUS_COLOR[s]} size="small">{t(`loop.status.${s}`)}</Tag>
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className="loop-createissue__field">
            <label>{t("loop.field.priority")}</label>
            <Select value={priority} onChange={(v) => setPriority(v as IssuePriority)} dropdownClassName="loop-fields__dropdown" style={{ width: "100%" }} size="small">
              {PRIORITY_ORDER.map((p) => (
                <Select.Option key={p} value={p}>
                  <Tag color={PRIORITY_COLOR[p]} size="small">{t(`loop.priority.${p}`)}</Tag>
                </Select.Option>
              ))}
            </Select>
          </div>
        </div>

        <div className="loop-createissue__row">
          <div className="loop-createissue__field">
            <label>{t("loop.field.assignee")}</label>
            <div className="loop-createissue__assignee">
              <AssigneePicker value={assigneeId} valueName={null} onChange={(id, type) => { setAssigneeId(id); setAssigneeType(type); }} />
            </div>
          </div>
          <div className="loop-createissue__field">
            <label>{t("loop.field.project")}</label>
            <Select
              value={projectId ?? undefined}
              onChange={(v) => setProjectId((v as string) ?? null)}
              dropdownClassName="loop-fields__dropdown"
              style={{ width: "100%" }}
              size="small"
              showClear
              placeholder={t("loop.field.noProject")}
            >
              {projects.map((p) => (
                <Select.Option key={p.id} value={p.id}>{p.icon} {p.title}</Select.Option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
