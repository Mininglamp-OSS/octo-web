import React, { useMemo } from "react";
import { Button, Input } from "@douyinfe/semi-ui";
import type { FlowNodeConfig } from "../../types/flow";
import { previewNextCronRuns } from "../../utils/cronPreview";

interface Props {
  config: FlowNodeConfig;
  onChange: (patch: Partial<FlowNodeConfig>) => void;
}

interface CronTemplate {
  label: string;
  expression: string;
  hint: string;
}

// 5-field expressions: more universally portable than 6-field. The preview
// utility internally fills seconds=0 when only 5 fields are supplied so the
// "下次执行" timestamp is correct either way.
const CRON_TEMPLATES: CronTemplate[] = [
  { label: "每分钟", expression: "* * * * *", hint: "每 60 秒触发一次" },
  { label: "每小时", expression: "0 * * * *", hint: "每小时整点触发" },
  { label: "每天", expression: "0 9 * * *", hint: "每天 09:00 触发" },
  { label: "每周", expression: "0 9 * * 1", hint: "每周一 09:00 触发" },
];

export default function CronConfig({ config, onChange }: Props) {
  const expr = config.cronExpression ?? "";
  const tz = config.cronTimezone ?? "";

  const { runs, error } = useMemo(() => previewNextCronRuns(expr, 3), [expr]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>常用模板</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CRON_TEMPLATES.map((tpl) => {
            const active = expr.trim() === tpl.expression;
            return (
              <Button
                key={tpl.label}
                size="small"
                theme={active ? "solid" : "light"}
                type={active ? "primary" : "tertiary"}
                onClick={() => onChange({ cronExpression: tpl.expression })}
                title={`${tpl.expression} — ${tpl.hint}`}
              >
                {tpl.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Cron 表达式</div>
        <Input
          value={expr}
          placeholder="0 */5 * * * *"
          onChange={(v) => onChange({ cronExpression: v })}
        />
        <div style={{ fontSize: 11, color: "var(--semi-color-text-2)", marginTop: 4 }}>
          支持 5 字段（分 时 日 月 周）或 6 字段（含秒）格式。
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>时区</div>
        <Input
          value={tz}
          placeholder="Asia/Shanghai"
          onChange={(v) => onChange({ cronTimezone: v })}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>下次执行</div>
        {error ? (
          <div style={{ fontSize: 12, color: "var(--semi-color-danger)" }}>{error}</div>
        ) : runs.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
            输入合法表达式后会预览下一次触发时间。
          </div>
        ) : (
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 12 }}>
            {runs.map((r, i) => (
              <li key={i}>{r.toLocaleString()}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
