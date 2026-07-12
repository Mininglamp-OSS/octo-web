import React, { useEffect, useState } from "react";
import { Modal, Toast } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { AutopilotTrigger } from "../api/types";
import { createAutopilotTrigger, updateAutopilotTrigger } from "../api/autopilotApi";
import ScheduleFields from "./ScheduleFields";
import "./loopControls.css";
import {
  type ScheduleConfig,
  getDefaultScheduleConfig,
  parseCron,
  toCron,
} from "./autopilotSchedule";

export interface TriggerEditModalProps {
  visible: boolean;
  autopilotId: string;
  /** 传入即为编辑，否则为新增。 */
  trigger?: AutopilotTrigger | null;
  onClose: () => void;
  onSaved: () => void;
}

/** 添加/编辑定时触发器（仅 schedule 类型）。 */
export default function TriggerEditModal({ visible, autopilotId, trigger, onClose, onSaved }: TriggerEditModalProps) {
  const { t } = useI18n();
  const isEdit = !!trigger;
  const [cfg, setCfg] = useState<ScheduleConfig>(getDefaultScheduleConfig());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCfg(
      trigger
        ? parseCron(trigger.cron_expression, trigger.timezone ?? getDefaultScheduleConfig().timezone)
        : getDefaultScheduleConfig(),
    );
  }, [visible, trigger]);

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const cron = toCron(cfg);
      if (isEdit && trigger) {
        await updateAutopilotTrigger(autopilotId, trigger.id, { cron_expression: cron, timezone: cfg.timezone });
      } else {
        await createAutopilotTrigger(autopilotId, { kind: "schedule", cron_expression: cron, timezone: cfg.timezone });
      }
      Toast.success(t("loop.toast.saved"));
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
      title={isEdit ? t("loop.automation.editTrigger") : t("loop.automation.addTrigger")}
      visible={visible}
      onCancel={onClose}
      onOk={doSubmit}
      okText={isEdit ? t("loop.action.save") : t("loop.automation.addTrigger")}
      cancelText={t("loop.action.cancel")}
      okButtonProps={{ loading: submitting }}
      width={460}
    >
      <div className="loop-fields">
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.automation.trigger")}</div>
          <ScheduleFields config={cfg} onChange={setCfg} />
        </div>
      </div>
    </Modal>
  );
}
