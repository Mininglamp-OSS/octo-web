import React, { useEffect, useMemo, useState } from "react";
import { Typography, Input, Spin, Empty, Tag, Avatar, Banner } from "@douyinfe/semi-ui";
import { Search, Monitor, Cloud, Cpu, Circle, Bot } from "lucide-react";
import { useI18n } from "@octo/base";
import type { RuntimeDevice, RuntimeMode, Agent } from "../api/types";
import { listRuntimes } from "../api/runtimeApi";
import { listAgents } from "../api/agentApi";
import "./runtime.css";

const { Title, Text } = Typography;

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

/**
 * 设备页（四栏）：Loop一级 + 二级菜单 + [设备列表(本地/远程) | 选中设备的 Runtime 列表 | Runtime 详情]。
 * 设备 = 按 daemon_id 聚合的机器；Runtime = 该机器上的各运行时；详情含「哪些 agents 在用」。
 */
export default function RuntimePage() {
  const { t } = useI18n();
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const [runtimeId, setRuntimeId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([listRuntimes(), listAgents()])
      .then(([rs, ags]) => {
        setRuntimes(rs);
        setAgents(ags);
      })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, []);

  const devices = useMemo<Device[]>(() => {
    const kw = keyword.trim().toLowerCase();
    const rows = kw
      ? runtimes.filter((r) => deviceName(r).toLowerCase().includes(kw) || r.provider.toLowerCase().includes(kw))
      : runtimes;
    const map = new Map<string, Device>();
    for (const r of rows) {
      const key = r.daemon_id || deviceName(r);
      let d = map.get(key);
      if (!d) {
        d = { key, name: deviceName(r), mode: r.runtime_mode, runtimes: [] };
        map.set(key, d);
      }
      d.runtimes.push(r);
    }
    return Array.from(map.values());
  }, [runtimes, keyword]);

  // 默认选中第一个设备 + 第一个 runtime
  useEffect(() => {
    if (!deviceKey && devices[0]) {
      setDeviceKey(devices[0].key);
      setRuntimeId(devices[0].runtimes[0]?.id ?? null);
    }
  }, [devices, deviceKey]);

  const groups = useMemo(() => {
    const local = devices.filter((d) => d.mode !== "cloud");
    const remote = devices.filter((d) => d.mode === "cloud");
    return [
      { key: "local", label: t("loop.device.local"), icon: <Monitor size={13} />, items: local },
      { key: "remote", label: t("loop.device.remote"), icon: <Cloud size={13} />, items: remote },
    ].filter((g) => g.items.length > 0);
  }, [devices, t]);

  const activeDevice = devices.find((d) => d.key === deviceKey) ?? null;
  const activeRuntime = runtimes.find((r) => r.id === runtimeId) ?? null;
  const agentsUsing = activeRuntime ? agents.filter((a) => a.runtime_id === activeRuntime.id) : [];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.runtime")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.runtime.search")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
      </div>
      <div className="loop-page__body" style={{ padding: 0 }}>
        {error ? (
          <div style={{ padding: 20 }}><Banner type="danger" description={error} /></div>
        ) : loading ? (
          <div className="loop-page__center"><Spin /></div>
        ) : devices.length === 0 ? (
          <div className="loop-empty"><Cpu size={40} className="loop-empty__icon" /><div className="loop-empty__title">{t("loop.runtime.empty")}</div></div>
        ) : (
          <div className="loop-dev">
            {/* 第3栏：设备列表（本地/远程分组） */}
            <div className="loop-dev__col loop-dev__devices">
              <div className="loop-dev__col-title">{t("loop.device.devices")}</div>
              {groups.map((g) => (
                <div key={g.key} className="loop-dev__grp">
                  <div className="loop-dev__grp-title">{g.icon}<span>{g.label}</span><em>{g.items.length}</em></div>
                  {g.items.map((d) => (
                    <button key={d.key} className={`loop-dev__row ${d.key === deviceKey ? "is-active" : ""}`}
                      onClick={() => { setDeviceKey(d.key); setRuntimeId(d.runtimes[0]?.id ?? null); }}>
                      <Monitor size={14} />
                      <span className="loop-dev__row-main"><strong>{d.name}</strong><small>{d.runtimes.length} runtimes</small></span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* 第4栏：选中设备的 Runtime 列表 */}
            <div className="loop-dev__col loop-dev__runtimes">
              <div className="loop-dev__col-title">{t("loop.device.runtimes")}</div>
              {!activeDevice ? (
                <div className="loop-dev__hint">{t("loop.device.pickDevice")}</div>
              ) : (
                activeDevice.runtimes.map((r) => (
                  <button key={r.id} className={`loop-dev__row ${r.id === runtimeId ? "is-active" : ""}`} onClick={() => setRuntimeId(r.id)}>
                    <Circle size={8} style={{ color: r.status === "online" ? "#23a55a" : "#c9cdd4" }} />
                    <span className="loop-dev__row-main"><strong>{r.provider}</strong><small>{r.name}</small></span>
                    <time>{relTime(r.last_seen_at)}</time>
                  </button>
                ))
              )}
            </div>

            {/* Runtime 详情（含使用中的 agents） */}
            <div className="loop-dev__col loop-dev__detail">
              {!activeRuntime ? (
                <div className="loop-dev__hint">{t("loop.device.pickRuntime")}</div>
              ) : (
                <div className="loop-dev__detail-inner">
                  <header className="loop-dev__detail-head">
                    <Avatar color="light-blue" shape="square"><Cpu size={18} /></Avatar>
                    <div>
                      <Title heading={5} style={{ margin: 0 }}>
                        <Circle size={9} style={{ marginRight: 6, color: activeRuntime.status === "online" ? "#23a55a" : "#c9cdd4" }} />
                        {activeRuntime.name}
                      </Title>
                      <Text type="tertiary" style={{ fontSize: 12 }}>{activeRuntime.provider}</Text>
                    </div>
                    <Tag color={activeRuntime.status === "online" ? "green" : "grey"} style={{ marginLeft: "auto" }}>
                      {t(`loop.runtime.${activeRuntime.status}`)}
                    </Tag>
                  </header>

                  <dl className="loop-dev__fields">
                    <dt>{t("loop.runtime.mode")}</dt><dd>{t(`loop.runtime.modeVal.${activeRuntime.runtime_mode}`) || activeRuntime.runtime_mode}</dd>
                    <dt>{t("loop.runtime.device")}</dt><dd>{activeRuntime.device_info}</dd>
                    <dt>{t("loop.runtime.launchHeader")}</dt><dd>{activeRuntime.launch_header ?? "—"}</dd>
                    <dt>{t("loop.runtime.visibility")}</dt><dd>{activeRuntime.visibility}</dd>
                    <dt>{t("loop.runtime.lastSeen")}</dt><dd>{relTime(activeRuntime.last_seen_at)} ago</dd>
                  </dl>

                  <div className="loop-dev__section-title">{t("loop.device.agentsUsing")} ({agentsUsing.length})</div>
                  {agentsUsing.length === 0 ? (
                    <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.device.noAgents")}</Text>
                  ) : (
                    <div className="loop-dev__agents">
                      {agentsUsing.map((a) => (
                        <div key={a.id} className="loop-dev__agent">
                          <Avatar size="extra-extra-small" color="violet"><Bot size={12} /></Avatar>
                          <Text>{a.name}</Text>
                          <Tag size="small" color="grey">{a.model}</Tag>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
