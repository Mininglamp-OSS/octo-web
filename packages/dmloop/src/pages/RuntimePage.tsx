import React, { useEffect, useMemo, useRef, useState } from "react";
import { Typography, Spin, Tag, Banner, Button, Toast } from "@douyinfe/semi-ui";
import { Box, Check, Circle, Code2, Copy, Cpu, Monitor, Plus, Terminal } from "lucide-react";
import { copyToClipboard, useI18n, WKModal } from "@octo/base";
import type { RuntimeDevice, RuntimeMode } from "../api/types";
import { listRuntimes } from "../api/runtimeApi";
import { issueHeadlessCliToken, getDaemonServerUrl } from "../api/authApi";
import { headlessCommand } from "./headlessCommand";
import { deviceVersion, runtimeVersion } from "./runtimeVersion";
import "./runtime.css";

const { Title } = Typography;

function envValue(key: string): string {
  return (import.meta as { env?: Record<string, string | undefined> }).env?.[key]?.trim() ?? "";
}

function originOf(value: string): string {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function currentOrigin(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return originOf(envValue("VITE_APP_URL")) || originOf(envValue("VITE_API_URL"));
}

// 「添加计算机」引导命令：octo-daemon 以当前 web 站点 origin 作为 --server-url
// （daemon 会据此推导 fleet 地址）。
function addComputerCommand(): string {
  return `octo-daemon --server-url ${currentOrigin()}`;
}

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

function deviceStatus(runtimes: RuntimeDevice[]): RuntimeDevice["status"] {
  return runtimes.some((runtime) => runtime.status === "online") ? "online" : "offline";
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
  const [daemonServerUrl, setDaemonServerUrl] = useState("");
  const [headlessCommandText, setHeadlessCommandText] = useState("");
  const [headlessLoading, setHeadlessLoading] = useState(false);
  const [headlessCopied, setHeadlessCopied] = useState(false);
  // 同步重入守卫：React state 是异步提交的，挡不住同一 tick 内的连点；
  // 用 ref 在签发前就拦住并发点击，保证一次会话只签发一个 PAT。
  const mintingRef = useRef(false);

  useEffect(() => {
    getDaemonServerUrl().then(setDaemonServerUrl).catch(() => setDaemonServerUrl(""));
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!headlessCopied) return undefined;
    const timer = window.setTimeout(() => setHeadlessCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [headlessCopied]);

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
    const ok = await copyToClipboard(addComputerCommand());
    if (!ok) {
      Toast.error(t("loop.runtime.copyFailed"));
      return;
    }
    setCopied(true);
    Toast.success(t("loop.runtime.copySuccess"));
  };

  // 命令2 的复制：命令框里 token 段先显示占位符，只有点击复制的这一刻
  // 才向后端签发一次性 PAT 并把真实命令写入框；已签发过则直接复制既有命令，
  // 避免反复点击在账号里累积凭证。
  const onCopyHeadless = async () => {
    if (!daemonServerUrl) {
      Toast.warning(t("loop.runtime.headlessNoBackend"));
      return;
    }
    if (mintingRef.current) return;
    mintingRef.current = true;
    setHeadlessLoading(true);
    try {
      let cmd = headlessCommandText;
      if (!cmd) {
        const { token } = await issueHeadlessCliToken();
        cmd = headlessCommand(token, daemonServerUrl);
        setHeadlessCommandText(cmd);
      }
      const ok = await copyToClipboard(cmd);
      if (ok) {
        setHeadlessCopied(true);
        Toast.success(t("loop.runtime.copySuccess"));
      } else {
        // 真实命令已写入下方命令框，复制失败可手动复制。
        Toast.warning(t("loop.runtime.headlessCopyManual"));
      }
    } catch {
      Toast.error(t("loop.runtime.headlessFailed"));
    } finally {
      mintingRef.current = false;
      setHeadlessLoading(false);
    }
  };

  // 关闭「添加电脑」弹窗时清除已签发的真实命令/凭证，避免重开弹窗再次把
  // 上一次的 PAT 渲染出来。
  const closeAddDialog = () => {
    setAddOpen(false);
    setHeadlessCommandText("");
    setHeadlessCopied(false);
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
            {devices.map((device) => {
              const status = deviceStatus(device.runtimes);
              const version = deviceVersion(device.runtimes);
              return (
              <section className="loop-runtime-machine" key={device.key} aria-label={device.name}>
                <div className="loop-runtime-machine__head">
                  <div className="loop-runtime-machine__identity">
                    <span className="loop-runtime-machine__icon"><Monitor size={14} /></span>
                    <strong>{device.name}</strong>
                    <span className={`loop-runtime-status is-${status}`}>
                      <Circle size={6} fill="currentColor" />
                      {t(`loop.runtime.${status}`)}
                    </span>
                  </div>
                  <div className="loop-runtime-machine__meta">
                    {version !== "-" && <Tag size="small" color="grey">{version}</Tag>}
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
              );
            })}
          </div>
        )}
      </div>
      <WKModal
        visible={addOpen}
        onCancel={closeAddDialog}
        title={t("loop.runtime.addComputerTitle")}
        size="lg"
        footer={(
          <Button theme="borderless" type="tertiary" onClick={closeAddDialog}>
            {t("loop.action.cancel")}
          </Button>
        )}
      >
        <div className="loop-runtime-add">
          <p>{t("loop.runtime.addComputerDesc")}</p>

          <p>{t("loop.runtime.addComputerBrowser")}</p>
          <div className="loop-runtime-add__row">
            <pre className="loop-runtime-add__command"><code>{addComputerCommand()}</code></pre>
            <Button
              className="loop-runtime-add__copy"
              size="small"
              theme="solid"
              type="tertiary"
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={copyCommand}
            >
              {copied ? t("loop.runtime.copied") : t("loop.runtime.copy")}
            </Button>
          </div>

          <p>{t("loop.runtime.addComputerHeadless")}</p>
          {daemonServerUrl ? (
            <div className="loop-runtime-add__row">
              <pre className="loop-runtime-add__command"><code>{headlessCommandText || headlessCommand(t("loop.runtime.headlessTokenPlaceholder"), daemonServerUrl)}</code></pre>
              <Button
                className="loop-runtime-add__copy"
                size="small"
                theme="solid"
                type="tertiary"
                loading={headlessLoading}
                icon={headlessCopied ? <Check size={14} /> : <Copy size={14} />}
                onClick={onCopyHeadless}
              >
                {headlessCopied ? t("loop.runtime.copied") : t("loop.runtime.copy")}
              </Button>
            </div>
          ) : (
            <p className="loop-runtime-add__hint">{t("loop.runtime.headlessNoBackend")}</p>
          )}
        </div>
      </WKModal>
    </div>
  );
}
