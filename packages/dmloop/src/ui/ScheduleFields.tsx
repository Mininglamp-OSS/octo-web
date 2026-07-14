import React from "react";
import { Select, InputNumber, TimePicker, Typography } from "@douyinfe/semi-ui";
import { Clock } from "lucide-react";
import { useI18n } from "@octo/base";
import { type Frequency, type ScheduleConfig, describeSchedule } from "./autopilotSchedule";
import "./loopControls.css";

const { Text } = Typography;

const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** 定时排程配置字段（频率分段 + 日期/星期/月日 + 时间 + 下次运行预览）。
 *  供 CreateAutomationModal 与 TriggerEditModal 复用；调用方自行包裹 label/容器。 */
export default function ScheduleFields({
  config,
  onChange,
}: {
  config: ScheduleConfig;
  onChange: (config: ScheduleConfig) => void;
}) {
  const { t } = useI18n();
  const patch = (p: Partial<ScheduleConfig>) => onChange({ ...config, ...p });

  return (
    <>
      <div className="loop-seg" role="tablist">
        {FREQUENCIES.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={config.frequency === f}
            className={`loop-seg__btn${config.frequency === f ? " is-active" : ""}`}
            onClick={() => patch({ frequency: f })}
          >
            {t(`loop.automation.freq.${f}`)}
          </button>
        ))}
      </div>

      <div className="loop-fields__inline">
        {config.frequency === "weekly" && (
          <Select
            value={config.dayOfWeek}
            onChange={(v) => patch({ dayOfWeek: v as number })}
            dropdownClassName="loop-fields__dropdown"
            style={{ width: 110 }}
          >
            {WEEKDAYS.map((d) => (
              <Select.Option key={d} value={d}>{t(`loop.automation.weekdays.${d}`)}</Select.Option>
            ))}
          </Select>
        )}
        {config.frequency === "monthly" && (
          <InputNumber
            min={1}
            max={31}
            value={config.dayOfMonth}
            onChange={(v) => patch({ dayOfMonth: Math.max(1, Math.min(31, Number(v) || 1)) })}
            suffix={t("loop.automation.dayUnit")}
            style={{ width: 110 }}
          />
        )}
        <TimePicker
          format="HH:mm"
          value={config.time}
          onChange={(_, str) => patch({ time: (str as string) || config.time })}
          style={{ width: 120 }}
        />
      </div>

      <div className="loop-fields__note">
        <Clock size={13} />
        <Text type="tertiary" size="small">
          {t("loop.automation.nextRun")} {describeSchedule(config, t)}
        </Text>
      </div>
    </>
  );
}
