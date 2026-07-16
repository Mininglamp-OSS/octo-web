import React, { useEffect, useMemo, useRef, useState } from "react";
import { Typography, Spin, Banner, Toast } from "@douyinfe/semi-ui";
import { Check, Circle, Copy, Cpu, Monitor, Plus } from "lucide-react";
import { copyToClipboard, useI18n, WKModal } from "@octo/base";
import type { RuntimeDevice, RuntimeMode } from "../api/types";
import { listRuntimes } from "../api/runtimeApi";
import LoopTag from "../ui/LoopTag";
import LoopButton from "../ui/LoopButton";
import { ProviderLogo, providerName } from "../ui/providerLogo";
import { issueHeadlessCliToken } from "../api/authApi";
import { INSTALL_SCRIPT_CMD, authCommand, START_CMD } from "./headlessCommand";
import { deviceVersion, runtimeVersion } from "./runtimeVersion";
import "./runtime.css";

const { Title } = Typography;

interface Device {
  key: string;
  name: string;
  mode: RuntimeMode;
  runtimes: RuntimeDevice[];
}

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

/** Runtime 列表页：机器作为分组，组内展示该机器上的 runtimes。 */
export default function RuntimePage() {
  const { t } = useI18n();
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // 同步重入守卫：React state 是异步提交的，挡不住同一 tick 内的连点；
  // 用 ref 在签发前就拦住并发点击，保证一次会话只签发一个 PAT。
  const mintingRef = useRef(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

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

  // 统一安装指令(给 AI 队友的提示词):安装 → 配置权限(登录认证) → 启动/重启。
  // --server-url 用当前访问的 host(浏览器地址),让 daemon 直连用户正在访问的站点。
  // token 占位符仅用于弹窗预览;真实 PAT 在点击「复制安装指令」时才签发。
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
  const buildPrompt = (token: string) =>
    t("loop.runtime.installPrompt", {
      values: { install: INSTALL_SCRIPT_CMD, auth: authCommand(token, serverUrl), start: START_CMD },
    });

  // 「复制安装指令」:提示词里 token 段先显示占位符,只有点击复制的这一刻才向后端签发
  // 一次性 PAT 并把真实提示词写入框;已签发过则直接复制既有提示词,避免反复点击累积凭证。
  const onCopyInstall = async () => {
    if (mintingRef.current) return;
    mintingRef.current = true;
    setCopyLoading(true);
    try {
      let text = promptText;
      if (!text) {
        const { token } = await issueHeadlessCliToken();
        text = buildPrompt(token);
        setPromptText(text);
      }
      const ok = await copyToClipboard(text);
      if (ok) {
        setCopied(true);
        Toast.success(t("loop.runtime.copySuccess"));
      } else {
        // 真实提示词已写入下方框,复制失败可手动复制。
        Toast.warning(t("loop.runtime.copyFailed"));
      }
    } catch {
      Toast.error(t("loop.runtime.headlessFailed"));
    } finally {
      mintingRef.current = false;
      setCopyLoading(false);
    }
  };

  // 关闭「添加电脑」弹窗时清除已签发的真实提示词/凭证,避免重开弹窗再次把上一次的 PAT 渲染出来。
  const closeAddDialog = () => {
    setAddOpen(false);
    setPromptText("");
    setCopied(false);
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
        <LoopButton icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>
          {t("loop.runtime.add")}
        </LoopButton>
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
                    {version !== "-" && <LoopTag tone="grey">{version}</LoopTag>}
                    <span>{shortDaemon(device.runtimes[0]?.daemon_id)}</span>
                    <span>{t("loop.runtime.allSpace")}</span>
                    <strong>{t("loop.runtime.runtimeCount", { values: { count: device.runtimes.length } })}</strong>
                  </div>
                </div>
                <div className="loop-runtime-rows" role="table" aria-label={`${device.name} ${t("loop.nav.runtime")}`}>
                  {device.runtimes.map((runtime) => (
                    <div key={runtime.id} className="loop-runtime-row" role="row">
                      <div className="loop-runtime-row__name" role="cell">
                        <ProviderLogo provider={runtime.provider} />
                        <strong>{providerName(runtime.provider)}</strong>
                        <LoopTag tone="grey">{t("loop.runtime.builtIn")}</LoopTag>
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
          <LoopButton variant="secondary" onClick={closeAddDialog}>
            {t("loop.action.cancel")}
          </LoopButton>
        )}
      >
        <div className="loop-runtime-add">
          <p>{t("loop.runtime.addComputerDesc")}</p>

          <p>{t("loop.runtime.installHint")}</p>
          <div className="loop-runtime-add__row">
            <div className="loop-runtime-add__bar">
              <LoopButton
                className="loop-runtime-add__copy"
                variant="secondary"
                size="sm"
                loading={copyLoading}
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={onCopyInstall}
              >
                {copied ? t("loop.runtime.copied") : t("loop.runtime.copyInstall")}
              </LoopButton>
            </div>
            <pre className="loop-runtime-add__command"><code>{promptText || buildPrompt(t("loop.runtime.installTokenPlaceholder"))}</code></pre>
          </div>
        </div>
      </WKModal>
    </div>
  );
}
