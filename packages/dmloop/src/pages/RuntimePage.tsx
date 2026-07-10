import React, { useEffect, useMemo, useState } from "react";
import { Typography, Spin, Tag, Banner, Button, Toast } from "@douyinfe/semi-ui";
import { Box, Check, Circle, Code2, Copy, Cpu, Monitor, Plus, Terminal } from "lucide-react";
import { copyToClipboard, useI18n, WKModal } from "@octo/base";
import type { RuntimeDevice, RuntimeMode } from "../api/types";
import { listRuntimes } from "../api/runtimeApi";
import "./runtime.css";

const { Title } = Typography;

const ADD_COMPUTER_COMMAND = `MULTICA_APP_URL=https://octo-dev.mlamp.cn \\
./octo-daemon \\
  --server-url https://octo-dev.mlamp.cn/fleet/api/v1 \\
  login`;

interface Device {
  key: string;
  name: string;
  mode: RuntimeMode;
  runtimes: RuntimeDevice[];
}

type ProviderTone = "claude" | "codex" | "hermes" | "openclaw" | "opencode" | "default";

function deviceName(r: RuntimeDevice): string {
  const info = r.device_info || "";
  const head = info.split("·")[0]?.trim();
  return head || r.name;
}

function runtimeVersion(r: RuntimeDevice): string {
  const version = r.metadata?.version;
  if (typeof version === "string" && version.trim()) return version.trim();
  const info = r.device_info || "";
  const parts = info.split("·").map((part) => part.trim()).filter(Boolean);
  return parts.slice(1).join(" · ") || r.launch_header || "-";
}

function relTime(iso: string | null): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function shortDaemon(id?: string | null): string {
  if (!id) return "-";
  return `daemon ${id.slice(0, 8)}`;
}

function providerName(provider: string): string {
  if (!provider) return "-";
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}

function providerTone(provider: string): ProviderTone {
  const key = provider.toLowerCase();
  if (key.includes("claude")) return "claude";
  if (key.includes("codex")) return "codex";
  if (key.includes("hermes")) return "hermes";
  if (key.includes("openclaw")) return "openclaw";
  if (key.includes("opencode")) return "opencode";
  return "default";
}

function providerIcon(provider: string) {
  const tone = providerTone(provider);
  if (tone === "codex") return <Box size={12} />;
  if (tone === "opencode") return <Code2 size={12} />;
  if (tone === "default") return <Terminal size={12} />;
  return <span aria-hidden>{providerName(provider).slice(0, 1)}</span>;
}

/** Runtime 列表页：机器作为分组，组内展示该机器上的 runtimes。 */
export default function RuntimePage() {
  const { t } = useI18n();
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listRuntimes()
      .then((rs) => {
        setRuntimes(rs);
      })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, []);

  const devices = useMemo<Device[]>(() => {
    const map = new Map<string, Device>();
    for (const r of runtimes) {
      const key = r.daemon_id || deviceName(r);
      let d = map.get(key);
      if (!d) {
        d = { key, name: deviceName(r), mode: r.runtime_mode, runtimes: [] };
        map.set(key, d);
      }
      d.runtimes.push(r);
    }
    return Array.from(map.values());
  }, [runtimes]);

  const copyCommand = async () => {
    const ok = await copyToClipboard(ADD_COMPUTER_COMMAND);
    if (!ok) {
      Toast.error(t("loop.runtime.copyFailed"));
      return;
    }
    setCopied(true);
    Toast.success(t("loop.runtime.copySuccess"));
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="loop-page">
      <div className="loop-runtime-hero">
        <div>
          <div className="loop-runtime-hero__title">
            <Title heading={4}>{t("loop.nav.runtime")}</Title>
            <span>{runtimes.length}</span>
          </div>
          <div className="loop-runtime-hero__subtitle">{t("loop.runtime.subtitle")}</div>
        </div>
        <Button className="loop-runtime-hero__action" theme="solid" type="tertiary" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>
          {t("loop.runtime.add")}
        </Button>
      </div>
      <div className="loop-page__body" style={{ padding: 0 }}>
        {error ? (
          <div style={{ padding: 20 }}><Banner type="danger" description={error} /></div>
        ) : loading ? (
          <div className="loop-page__center"><Spin /></div>
        ) : devices.length === 0 ? (
          <div className="loop-empty"><Cpu size={40} className="loop-empty__icon" /><div className="loop-empty__title">{t("loop.runtime.empty")}</div></div>
        ) : (
          <div className="loop-runtime-list">
            {devices.map((device) => (
              <section className="loop-runtime-machine" key={device.key} aria-label={device.name}>
                <div className="loop-runtime-machine__head">
                  <div className="loop-runtime-machine__identity">
                    <span className="loop-runtime-machine__icon"><Monitor size={14} /></span>
                    <strong>{device.name}</strong>
                    <span className="loop-runtime-status is-online">
                      <Circle size={6} fill="currentColor" />
                      {t("loop.runtime.online")}
                    </span>
                  </div>
                  <div className="loop-runtime-machine__meta">
                    <Tag size="small" color="grey">v0.3.12</Tag>
                    <span>{shortDaemon(device.runtimes[0]?.daemon_id)}</span>
                    <span>{t("loop.runtime.allSpace")}</span>
                    <strong>{t("loop.runtime.runtimeCount", { values: { count: device.runtimes.length } })}</strong>
                  </div>
                </div>
                <div className="loop-runtime-rows" role="table" aria-label={`${device.name} ${t("loop.nav.runtime")}`}>
                  {device.runtimes.map((runtime) => (
                    <div key={runtime.id} className="loop-runtime-row" role="row">
                      <div className="loop-runtime-row__name" role="cell">
                        <span className={`loop-runtime-row__provider is-${providerTone(runtime.provider)}`}>
                          {providerIcon(runtime.provider)}
                        </span>
                        <strong>{providerName(runtime.provider)}</strong>
                        <Tag size="small" color="grey">{t("loop.runtime.builtIn")}</Tag>
                      </div>
                      <div className={`loop-runtime-status is-${runtime.status}`} role="cell">
                        <Circle size={6} fill="currentColor" />
                        {t(`loop.runtime.${runtime.status}`)}
                      </div>
                      <div className="loop-runtime-row__version" role="cell">{runtimeVersion(runtime)}</div>
                      <time className="loop-runtime-row__seen" role="cell">{relTime(runtime.last_seen_at)}</time>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <WKModal
        visible={addOpen}
        onCancel={() => setAddOpen(false)}
        title={t("loop.runtime.addComputerTitle")}
        size="lg"
        footer={(
          <>
            <Button theme="borderless" type="tertiary" onClick={() => setAddOpen(false)}>
              {t("loop.action.cancel")}
            </Button>
            <Button theme="solid" type="tertiary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyCommand}>
              {copied ? t("loop.runtime.copied") : t("loop.runtime.copyCommand")}
            </Button>
          </>
        )}
      >
        <div className="loop-runtime-add">
          <p>{t("loop.runtime.addComputerDesc")}</p>
          <pre className="loop-runtime-add__command"><code>{ADD_COMPUTER_COMMAND}</code></pre>
        </div>
      </WKModal>
    </div>
  );
}
