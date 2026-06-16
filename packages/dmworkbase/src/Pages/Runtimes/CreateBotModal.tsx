import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Toast } from '@douyinfe/semi-ui';
import { createBot, isSupportedRuntimeKind, providerLabels } from './botsApi';
import { useI18n } from '../../i18n';

// CreateBotModal — 2-step device-first selector.
//
// Background: a single user can register multiple devices (= multiple
// daemons). Each device contributes its own set of runtimes (openclaw
// / claude). If the modal showed a flat runtime list
// keyed only on `kind`, the user couldn't distinguish "openclaw on
// laptop-1" from "openclaw on laptop-2" — picking by kind alone would
// silently bind to whichever entry was first. So the modal asks for
// device first, then offers the runtime kinds available on that device.

interface RuntimeOption {
  id: number;
  name: string;
  kind: string;
  supported: boolean;
  daemon_id: string;
  device_name: string;
  status: string;
}

interface Props {
  visible: boolean;
  runtimes: RuntimeOption[];
  // caster 2026-06-12: preselectRuntimeId prop 删 — 左树
  // Level-3 空态 CTA (唯一 caller) 已随 "没 bot 不可展开" 改动移除.
  // 将来 runtime 行加创建入口时从 git history 取回 (含 supported+online
  // 校验逻辑).
  onClose: () => void;
  onCreated: (botId: number) => void;
}

interface DeviceGroup {
  // Stable composite key for grouping + selection. Same value used as the
  // map key in groupByDevice; we store it on the group so all selection
  // (chip key prop / setDeviceKey / activeGroup find / handleDevicePick)
  // goes through ONE field. daemon_id below is purely for display.
  //
  // Why this matters: using daemon_id alone
  // for selection silently mis-binds when ≥2 devices have empty daemon_id
  // (both 'find(g => g.daemon_id === "")' return the first group regardless
  // of which chip the user clicked) — exactly the failure mode the
  // RuntimeListEntry comment was written to prevent.
  key: string;
  daemon_id: string;
  device_name: string;
  runtimes: RuntimeOption[];
  hasSupportedOnline: boolean;
}

function groupKey(r: { daemon_id: string; device_name: string }): string {
  return r.daemon_id || r.device_name || 'unknown';
}

function groupByDevice(runtimes: RuntimeOption[]): DeviceGroup[] {
  const map = new Map<string, DeviceGroup>();
  for (const r of runtimes) {
    const key = groupKey(r);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        daemon_id: r.daemon_id,
        device_name: r.device_name || r.daemon_id || 'unknown',
        runtimes: [],
        hasSupportedOnline: false,
      };
      map.set(key, g);
    }
    g.runtimes.push(r);
    if (r.supported && r.status === 'online') g.hasSupportedOnline = true;
  }
  // Stable order: devices with at least one online supported runtime first
  return Array.from(map.values()).sort((a, b) => {
    if (a.hasSupportedOnline !== b.hasSupportedOnline) return a.hasSupportedOnline ? -1 : 1;
    return a.device_name.localeCompare(b.device_name);
  });
}

export function CreateBotModal({ visible, runtimes, onClose, onCreated }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const [runtimeId, setRuntimeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => groupByDevice(runtimes), [runtimes]);

  // Reset state on open.
  // 优先级:
  //   (1) firstReady (有 supported+online runtime 的第一个 device)
  //   (2) 否则随便选第一个 device, runtime 留空
  // (preselectRuntimeId 分支已删 — 死链路, 见 Props 注释)
  useEffect(() => {
    if (!visible) return;
    setName('');
    setBusy(false);
    const firstReady = groups.find(g => g.hasSupportedOnline);
    if (firstReady) {
      setDeviceKey(firstReady.key);
      // 同 handleDevicePick: 只预选 supported+online, 找不到就留空.
      const firstRt = firstReady.runtimes.find(r => r.supported && r.status === 'online') ?? null;
      setRuntimeId(firstRt?.id ?? null);
    } else if (groups[0]) {
      setDeviceKey(groups[0].key);
      setRuntimeId(null);
    } else {
      setDeviceKey(null);
      setRuntimeId(null);
    }
  }, [visible, groups]);

  const activeGroup = useMemo(
    () => groups.find(g => g.key === deviceKey) ?? null,
    [groups, deviceKey],
  );
  const selectedRuntime = useMemo(
    () => activeGroup?.runtimes.find(r => r.id === runtimeId) ?? null,
    [activeGroup, runtimeId],
  );
  // 提交前必须保证 runtime 既 supported 又 online —— 否则 fleet 派发到离线
  // daemon 不会 ack, bot 进配置中后会卡几分钟超时变 failed.
  const canSubmit = !!name.trim()
    && !!selectedRuntime
    && selectedRuntime.supported
    && selectedRuntime.status === 'online'
    && !busy;

  const handleDevicePick = (g: DeviceGroup) => {
    setDeviceKey(g.key);
    // 只预选 supported + online 的 runtime, 不 fallback 到离线/不支持的 ——
    // 让用户主动看到该设备 0 个可用 runtime, 而不是默选个不可提交的项.
    const firstRt = g.runtimes.find(r => r.supported && r.status === 'online') ?? null;
    setRuntimeId(firstRt?.id ?? null);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selectedRuntime) return;
    // 类型守卫窄化:kind 是后端任意字符串,createBot 只接受受支持的 RuntimeKind。
    // canSubmit 已用 supported gate,这里再窄化让类型诚实(不支持的直接拦下)。
    if (!isSupportedRuntimeKind(selectedRuntime.kind)) return;
    setBusy(true);
    try {
      const bot = await createBot({
        runtime_id: selectedRuntime.id,
        name: name.trim(),
        runtime_kind: selectedRuntime.kind,
      });
      Toast.success(t("base.runtimes.createBot.created", { values: { name: bot.name } }));
      onCreated(bot.id);
      onClose();
    } catch (e: any) {
      Toast.error(t("base.runtimes.createBot.createFailed", { values: { error: String(e?.message || e) } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("base.runtimes.createBot.title")}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={busy ? t("base.runtimes.createBot.creating") : t("base.runtimes.createBot.create")}
      okButtonProps={{ disabled: !canSubmit }}
      maskClosable={!busy}
      width={520}
    >
      <div className="wk-rt-cb__form">
        <div className="wk-rt-cb__field">
          <label className="wk-rt-cb__label">{t("base.runtimes.createBot.name")}</label>
          <input
            className="wk-rt-cb__input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t("base.runtimes.createBot.namePlaceholder")}
            disabled={busy}
            autoFocus
            maxLength={64}
          />
        </div>

        <div className="wk-rt-cb__field">
          <label className="wk-rt-cb__label">{t("base.runtimes.createBot.device")}</label>
          {groups.length === 0 ? (
            <div className="wk-rt-cb__empty">
              {t("base.runtimes.createBot.noDevices")}
            </div>
          ) : (
            <div className="wk-rt-cb__chips" role="radiogroup" aria-label={t("base.runtimes.createBot.selectDeviceAria")}>
              {groups.map(g => {
                const active = deviceKey === g.key;
                return (
                  <button
                    type="button"
                    key={g.key}
                    role="radio"
                    aria-checked={active}
                    className={`wk-rt-cb__chip${active ? ' is-active' : ''}${
                      g.hasSupportedOnline ? '' : ' is-dim'
                    }`}
                    onClick={() => handleDevicePick(g)}
                    disabled={busy}
                  >
                    <span className="wk-rt-cb__chip-name">{g.device_name}</span>
                    <span className="wk-rt-cb__chip-meta">
                      {t("base.runtimes.createBot.onlineCount", { values: { online: g.runtimes.filter(r => r.status === 'online').length, total: g.runtimes.length } })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="wk-rt-cb__field">
          <label className="wk-rt-cb__label">{t("base.runtimes.createBot.runtime")}</label>
          {!activeGroup ? (
            <div className="wk-rt-cb__empty">{t("base.runtimes.createBot.selectDeviceFirst")}</div>
          ) : (
            <div className="wk-rt-cb__rt-list" role="radiogroup" aria-label={t("base.runtimes.createBot.selectRuntimeAria")}>
              {activeGroup.runtimes.map(r => {
                const isOnline = r.status === 'online';
                const enabled = r.supported && isOnline && !busy;
                return (
                  <label
                    key={r.id}
                    className={`wk-rt-cb__rt-row${runtimeId === r.id ? ' is-active' : ''}${
                      enabled ? '' : ' is-dim'
                    }`}
                  >
                    <input
                      type="radio"
                      name="runtime-pick"
                      checked={runtimeId === r.id}
                      onChange={() => enabled && setRuntimeId(r.id)}
                      disabled={!enabled}
                    />
                    <span className="wk-rt-cb__rt-kind">{providerLabels[r.kind] ?? r.kind}</span>
                    <span className="wk-rt-cb__rt-status" data-status={isOnline ? 'online' : 'offline'}>
                      {isOnline ? t("base.runtimes.common.online") : t("base.runtimes.common.offline")}
                    </span>
                    {!r.supported && (
                      <span className="wk-rt-cb__rt-tag">{t("base.runtimes.createBot.unsupported")}</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
