import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Select,
  TimePicker,
  DatePicker,
  InputNumber,
  Toast,
  Typography,
} from "@douyinfe/semi-ui";
import { Clock } from "lucide-react";
import { useI18n } from "@octo/base";
import type {
  Autopilot,
  AutopilotTrigger,
  AutopilotAssigneeType,
  AssigneeType,
} from "../api/types";
import {
  createAutopilot,
  updateAutopilot,
  createAutopilotTrigger,
  updateAutopilotTrigger,
} from "../api/autopilotApi";
import { listProjectOptions } from "../api/directory";
import AssigneePicker from "./AssigneePicker";
import "./loopControls.css";
import {
  type Frequency,
  type ScheduleConfig,
  getDefaultScheduleConfig,
  parseCron,
  toCron,
  describeSchedule,
} from "./autopilotSchedule";

const { Text } = Typography;

const FREQUENCIES: Frequency[] = ["once", "daily", "weekly", "monthly"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export interface AutomationEditing {
  autopilot: Autopilot;
  triggers: AutopilotTrigger[];
}

export interface CreateAutomationModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: AutomationEditing | null;
}

/** 新建/编辑自动化弹框（对齐 Figma 精简版；execution_mode 固定 create_issue、仅 schedule 触发）。 */
export default function CreateAutomationModal({ visible, onClose, onSaved, editing }: CreateAutomationModalProps) {
  const { t } = useI18n();
  const isEdit = !!editing;

  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeType, setAssigneeType] = useState<AutopilotAssigneeType>("agent");
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [cfg, setCfg] = useState<ScheduleConfig>(getDefaultScheduleConfig());
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  // 首个 schedule 触发器（编辑时用于 PATCH 排程）。
  const firstSchedule = useMemo(
    () => editing?.triggers.find((tr) => tr.kind === "schedule") ?? null,
    [editing],
  );

  useEffect(() => {
    if (!visible) return;
    listProjectOptions().then(setProjects).catch(() => setProjects([]));
    if (editing) {
      const a = editing.autopilot;
      setName(a.title);
      setAssigneeId(a.assignee_id);
      setAssigneeType(a.assignee_type);
      setAssigneeName(a.assignee_name ?? null);
      setProjectId(a.project_id ?? undefined);
      setDescription(a.description ?? "");
      setCfg(parseCron(firstSchedule?.cron_expression, firstSchedule?.timezone ?? getDefaultScheduleConfig().timezone));
    } else {
      setName("");
      setAssigneeId(null);
      setAssigneeType("agent");
      setAssigneeName(null);
      setProjectId(undefined);
      setDescription("");
      setCfg(getDefaultScheduleConfig());
    }
  }, [visible, editing, firstSchedule]);

  const onAssigneeChange = (id: string | null, type: AssigneeType | null, nm: string | null) => {
    setAssigneeId(id);
    if (type === "agent" || type === "squad") setAssigneeType(type);
    setAssigneeName(nm);
  };

  const patchCfg = (p: Partial<ScheduleConfig>) => setCfg((prev) => ({ ...prev, ...p }));

  const doSubmit = async () => {
    if (!name.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!assigneeId) { Toast.warning(t("loop.automation.executorRequired")); return; }
    setSubmitting(true);
    try {
      if (isEdit && editing) {
        const id = editing.autopilot.id;
        await updateAutopilot(id, {
          title: name.trim(),
          description: description.trim() || null,
          project_id: projectId ?? null,
          assignee_type: assigneeType,
          assignee_id: assigneeId,
        });
        const cron = toCron(cfg);
        if (firstSchedule) {
          if (cron !== firstSchedule.cron_expression || cfg.timezone !== firstSchedule.timezone) {
            await updateAutopilotTrigger(id, firstSchedule.id, { cron_expression: cron, timezone: cfg.timezone });
          }
        } else {
          await createAutopilotTrigger(id, { kind: "schedule", cron_expression: cron, timezone: cfg.timezone });
        }
        Toast.success(t("loop.toast.saved"));
      } else {
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
          // 部分成功：autopilot 已建、排程失败 —— 提示原因，让用户回去补排程。
          Toast.error((e as Error)?.message ?? t("loop.automation.triggerFailed"));
        }
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
      title={isEdit ? t("loop.automation.editTitle") : t("loop.automation.newTitle")}
      visible={visible}
      onCancel={onClose}
      onOk={doSubmit}
      okText={isEdit ? t("loop.action.save") : t("loop.automation.create")}
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
          <div className="loop-seg" role="tablist">
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={cfg.frequency === f}
                className={`loop-seg__btn${cfg.frequency === f ? " is-active" : ""}`}
                onClick={() => patchCfg({ frequency: f })}
              >
                {t(`loop.automation.freq.${f}`)}
              </button>
            ))}
          </div>

          <div className="loop-fields__inline">
            {cfg.frequency === "once" && (
              <DatePicker
                type="date"
                format="yyyy-MM-dd"
                value={cfg.date}
                onChange={(_, ds) => patchCfg({ date: (ds as string) || cfg.date })}
                style={{ width: 150 }}
              />
            )}
            {cfg.frequency === "weekly" && (
              <Select
                value={cfg.dayOfWeek}
                onChange={(v) => patchCfg({ dayOfWeek: v as number })}
                dropdownClassName="loop-fields__dropdown"
                style={{ width: 110 }}
              >
                {WEEKDAYS.map((d) => (
                  <Select.Option key={d} value={d}>{t(`loop.automation.weekdays.${d}`)}</Select.Option>
                ))}
              </Select>
            )}
            {cfg.frequency === "monthly" && (
              <InputNumber
                min={1}
                max={31}
                value={cfg.dayOfMonth}
                onChange={(v) => patchCfg({ dayOfMonth: Math.max(1, Math.min(31, Number(v) || 1)) })}
                suffix={t("loop.automation.dayUnit")}
                style={{ width: 110 }}
              />
            )}
            <TimePicker
              format="HH:mm"
              value={cfg.time}
              onChange={(_, str) => patchCfg({ time: (str as string) || cfg.time })}
              style={{ width: 120 }}
            />
          </div>

          <div className="loop-fields__note">
            <Clock size={13} />
            <Text type="tertiary" size="small">
              {t("loop.automation.nextRun")} {describeSchedule(cfg, t)}
            </Text>
          </div>
        </div>

        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.automation.taskDesc")}</div>
          <div className="loop-fields__hint">{t("loop.automation.taskDescHint")}</div>
          <textarea
            className="loop-field-textarea"
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
