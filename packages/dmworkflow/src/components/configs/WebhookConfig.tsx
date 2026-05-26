import React from "react";
import { Button, Input, Select, Toast } from "@douyinfe/semi-ui";
import { IconCopy } from "@douyinfe/semi-icons";
import type { FlowNodeConfig } from "../../types/flow";

interface Props {
  config: FlowNodeConfig;
  onChange: (patch: Partial<FlowNodeConfig>) => void;
  /** Server-issued webhook URL (read-only); empty until flow is saved. */
  webhookUrl?: string;
}

export default function WebhookConfig({ config, onChange, webhookUrl }: Props) {
  const algo = config.signatureAlgo ?? "hmac-sha256";
  const url = webhookUrl ?? config.webhookUrl ?? "";

  const copy = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => Toast.success("已复制 webhook URL"),
      () => Toast.error("复制失败"),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Webhook URL</div>
        <div style={{ display: "flex", gap: 4 }}>
          <Input value={url} disabled placeholder="保存 flow 后由服务端分配" style={{ flex: 1 }} />
          <Button icon={<IconCopy />} disabled={!url} onClick={copy} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Secret</div>
        <Input
          value={config.secret ?? ""}
          placeholder="留空则不校验签名"
          onChange={(v) => onChange({ secret: v })}
          mode="password"
        />
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>签名 Header</div>
        <Input
          value={config.signatureHeader ?? ""}
          placeholder="X-Octo-Signature"
          onChange={(v) => onChange({ signatureHeader: v })}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>签名算法</div>
        <Select
          value={algo}
          style={{ width: "100%" }}
          onChange={(v) => onChange({ signatureAlgo: v as FlowNodeConfig["signatureAlgo"] })}
          optionList={[
            { value: "hmac-sha256", label: "HMAC-SHA256" },
            { value: "hmac-sha1", label: "HMAC-SHA1" },
            { value: "none", label: "不校验" },
          ]}
        />
      </div>
    </div>
  );
}
