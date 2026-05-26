import React from "react";
import { Button, Input, Select, TextArea } from "@douyinfe/semi-ui";
import { IconClose, IconPlus } from "@douyinfe/semi-icons";
import type { FlowNodeConfig } from "../../types/flow";

interface Props {
  config: FlowNodeConfig;
  onChange: (patch: Partial<FlowNodeConfig>) => void;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export default function HttpConfig({ config, onChange }: Props) {
  const headers = config.httpHeaders ?? [];

  const updateHeader = (idx: number, patch: Partial<{ key: string; value: string }>) => {
    const next = headers.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    onChange({ httpHeaders: next });
  };
  const addHeader = () => onChange({ httpHeaders: [...headers, { key: "", value: "" }] });
  const removeHeader = (idx: number) =>
    onChange({ httpHeaders: headers.filter((_, i) => i !== idx) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Select
          value={config.httpMethod ?? "GET"}
          style={{ width: 110 }}
          onChange={(v) => onChange({ httpMethod: v as FlowNodeConfig["httpMethod"] })}
          optionList={METHODS.map((m) => ({ value: m, label: m }))}
        />
        <Input
          value={config.httpUrl ?? ""}
          placeholder="https://example.com/api"
          onChange={(v) => onChange({ httpUrl: v })}
          style={{ flex: 1 }}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center" }}>
          <span style={{ flex: 1 }}>Headers</span>
          <Button size="small" icon={<IconPlus />} onClick={addHeader}>添加</Button>
        </div>
        {headers.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>暂无 header</div>
        ) : (
          headers.map((h, idx) => (
            <div key={idx} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <Input
                value={h.key}
                placeholder="Key"
                onChange={(v) => updateHeader(idx, { key: v })}
                style={{ flex: 1 }}
              />
              <Input
                value={h.value}
                placeholder="Value"
                onChange={(v) => updateHeader(idx, { value: v })}
                style={{ flex: 2 }}
              />
              <Button
                size="small"
                type="tertiary"
                icon={<IconClose />}
                onClick={() => removeHeader(idx)}
              />
            </div>
          ))
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Body</div>
        <TextArea
          value={config.httpBody ?? ""}
          placeholder='{"hello": "world"}'
          autosize={{ minRows: 4, maxRows: 12 }}
          style={{ fontFamily: "monospace", fontSize: 12 }}
          onChange={(v) => onChange({ httpBody: v })}
        />
      </div>
    </div>
  );
}
