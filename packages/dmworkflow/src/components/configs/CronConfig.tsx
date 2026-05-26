import React, { useMemo } from "react";
import { Input } from "@douyinfe/semi-ui";
import type { FlowNodeConfig } from "../../types/flow";
import { previewNextCronRuns } from "../../utils/cronPreview";

interface Props {
  config: FlowNodeConfig;
  onChange: (patch: Partial<FlowNodeConfig>) => void;
}

export default function CronConfig({ config, onChange }: Props) {
  const expr = config.cronExpression ?? "";
  const tz = config.cronTimezone ?? "";

  const { runs, error } = useMemo(() => previewNextCronRuns(expr, 3), [expr]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
