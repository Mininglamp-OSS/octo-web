import React, { useEffect, useState } from "react";
import { Modal, Select, Toast } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { AutopilotAssigneeType, AssigneeType } from "../api/types";
import { createAutopilot, createAutopilotTrigger } from "../api/autopilotApi";
import { listProjectOptions } from "../api/directory";
import AssigneePicker from "./AssigneePicker";
import ScheduleFields from "./ScheduleFields";
import "./loopControls.css";
import {
  type ScheduleConfig,
  getDefaultScheduleConfig,
  toCron,
} from "./autopilotSchedule";

export interface CreateAutomationModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** 新建自动化弹框（execution_mode 固定 create_issue，并配置第一个定时触发）。
 *  已创建的自动化在详情页内联编辑基础信息、在触发器区管理触发器。 */
export default function CreateAutomationModal({ visible, onClose, onSaved }: CreateAutomationModalProps) {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeType, setAssigneeType] = useState<AutopilotAssigneeType>("agent");
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [cfg, setCfg] = useState<ScheduleConfig>(getDefaultScheduleConfig());
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    listProjectOptions().then(setProjects).catch(() => setProjects([]));
    setName("");
    setAssigneeId(null);
    setAssigneeType("agent");
    setAssigneeName(null);
    setProjectId(undefined);
    setDescription("");
    setCfg(getDefaultScheduleConfig());
  }, [visible]);

  const onAssigneeChange = (id: string | null, type: AssigneeType | null, nm: string | null) => {
    setAssigneeId(id);
    if (type === "agent" || type === "squad") setAssigneeType(type);
    setAssigneeName(nm);
  };

  const doSubmit = async () => {
    if (!name.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!assigneeId) { Toast.warning(t("loop.automation.executorRequired")); return; }
    setSubmitting(true);
    try {
      const created = await createAutopilot({
        title: name.trim(),
        description: description.trim() || undefined,
        project_id: projectId ?? null,
        assignee_type: assigneeType,
        assignee_id: assigneeId,
        execution_mode: "create_issue",
      });
      try {
        await createAutopilotTrigger(created.id, {
          kind: "schedule",
          cron_expression: toCron(cfg),
          timezone: cfg.timezone,
        });
        Toast.success(t("loop.toast.created"));
      } catch (e) {
        // 部分成功：autopilot 已建、排程失败 —— 提示原因，让用户回详情页补排程。
        Toast.error((e as Error)?.message ?? t("loop.automation.triggerFailed"));
      }
      onSaved();
      onClose();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="loop-modal"
      title={t("loop.automation.newTitle")}
      visible={visible}
      onCancel={onClose}
      onOk={doSubmit}
      okText={t("loop.automation.create")}
      cancelText={t("loop.action.cancel")}
      okButtonProps={{ loading: submitting }}
      width={520}
    >
      <div className="loop-fields">
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.field.name")}</div>
          <input
            autoFocus
            className="loop-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("loop.automation.namePlaceholder")}
          />
        </div>

        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.automation.executor")}</div>
          <AssigneePicker
            value={assigneeId}
            valueName={assigneeName}
            types={["agent", "squad"]}
            onChange={onAssigneeChange}
          />
        </div>

        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.automation.sendTo")}</div>
          <Select
            value={projectId}
            onChange={(v) => setProjectId(v as string | undefined)}
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

        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.automation.trigger")}</div>
          <ScheduleFields config={cfg} onChange={setCfg} />
        </div>

        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.automation.taskDesc")}</div>
          <div className="loop-fields__hint">{t("loop.automation.taskDescHint")}</div>
          <textarea
            className="loop-field-textarea loop-field-textarea--lg"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("loop.automation.taskDescTemplate")}
            spellCheck={false}
          />
        </div>
      </div>
    </Modal>
  );
}
