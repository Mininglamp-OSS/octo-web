import React, { useEffect, useState } from "react";
import { Modal, Input, Select, Tag, TextArea } from "@douyinfe/semi-ui";
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
}

/**
 * 新建 Issue 弹窗（1:1 复刻 multica 手动创建）：
 * 标题 / 描述 / 指派(member|agent|squad 三态) / 状态 / 优先级 / 项目。
 */
export default function CreateIssueModal({ visible, onClose, onCreated }: CreateIssueModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(""); setDesc(""); setStatus("todo"); setPriority("none");
      setAssigneeId(null); setProjectId(null);
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
        project_id: projectId,
      });
      onClose();
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t("loop.action.newIssue")}
      visible={visible}
      onOk={submit}
      onCancel={onClose}
      okText={t("loop.action.create")}
      cancelText={t("loop.action.cancel")}
      okButtonProps={{ loading: submitting, disabled: !title.trim() }}
      width={560}
    >
      <div className="loop-createissue">
        <Input
          autoFocus
          size="large"
          value={title}
          onChange={setTitle}
          placeholder={t("loop.field.titlePlaceholder")}
          onEnterPress={submit}
        />
        <TextArea
          value={desc}
          onChange={setDesc}
          placeholder={t("loop.field.descriptionPlaceholder")}
          autosize={{ minRows: 3, maxRows: 8 }}
          style={{ marginTop: 12 }}
        />

        <div className="loop-createissue__row">
          <div className="loop-createissue__field">
            <label>{t("loop.field.status")}</label>
            <Select value={status} onChange={(v) => setStatus(v as IssueStatus)} style={{ width: "100%" }} size="small">
              {ISSUE_STATUS_ORDER.map((s) => (
                <Select.Option key={s} value={s}>
                  <Tag color={ISSUE_STATUS_COLOR[s]} size="small">{t(`loop.status.${s}`)}</Tag>
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className="loop-createissue__field">
            <label>{t("loop.field.priority")}</label>
            <Select value={priority} onChange={(v) => setPriority(v as IssuePriority)} style={{ width: "100%" }} size="small">
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
              <AssigneePicker value={assigneeId} valueName={null} onChange={setAssigneeId} />
            </div>
          </div>
          <div className="loop-createissue__field">
            <label>{t("loop.field.project")}</label>
            <Select
              value={projectId ?? undefined}
              onChange={(v) => setProjectId((v as string) ?? null)}
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
