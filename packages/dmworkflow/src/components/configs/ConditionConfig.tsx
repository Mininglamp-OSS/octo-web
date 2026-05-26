import React from "react";
import { Button, Input } from "@douyinfe/semi-ui";
import { IconClose, IconPlus } from "@douyinfe/semi-icons";
import type { FlowNodeConfig } from "../../types/flow";

interface Props {
  config: FlowNodeConfig;
  onChange: (patch: Partial<FlowNodeConfig>) => void;
}

export default function ConditionConfig({ config, onChange }: Props) {
  const branches = config.conditionBranches ?? [];

  const updateBranch = (idx: number, patch: Partial<{ value: string; label: string }>) => {
    const next = branches.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    onChange({ conditionBranches: next });
  };
  const addBranch = () =>
    onChange({ conditionBranches: [...branches, { value: "", label: "" }] });
  const removeBranch = (idx: number) =>
    onChange({ conditionBranches: branches.filter((_, i) => i !== idx) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>表达式</div>
        <Input
          value={config.conditionExpression ?? ""}
          placeholder="$.payload.status"
          onChange={(v) => onChange({ conditionExpression: v })}
        />
        <div style={{ fontSize: 11, color: "var(--semi-color-text-2)", marginTop: 4 }}>
          表达式的求值结果会与下方分支的 value 比较，匹配的分支会被执行。
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center" }}>
          <span style={{ flex: 1 }}>分支</span>
          <Button size="small" icon={<IconPlus />} onClick={addBranch}>添加</Button>
        </div>
        {branches.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
            暂无分支，至少添加一个。
          </div>
        ) : (
          branches.map((b, idx) => (
            <div key={idx} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <Input
                value={b.value}
                placeholder="value"
                onChange={(v) => updateBranch(idx, { value: v })}
                style={{ flex: 1 }}
              />
              <Input
                value={b.label}
                placeholder="label"
                onChange={(v) => updateBranch(idx, { label: v })}
                style={{ flex: 1 }}
              />
              <Button
                size="small"
                type="tertiary"
                icon={<IconClose />}
                onClick={() => removeBranch(idx)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
