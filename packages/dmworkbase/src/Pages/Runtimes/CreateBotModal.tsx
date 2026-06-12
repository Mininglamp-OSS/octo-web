import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Toast } from '@douyinfe/semi-ui';
import { createBot, providerLabels, RuntimeKind } from './botsApi';

// CreateBotModal — 2-step device-first selector.
//
// Background: a single user can register multiple devices (= multiple
// daemons). Each device contributes its own set of 4 runtimes (openclaw
// / claude / codex / hermes). If the modal showed a flat runtime list
// keyed only on `kind`, the user couldn't distinguish "openclaw on
// laptop-1" from "openclaw on laptop-2" — picking by kind alone would
// silently bind to whichever entry was first. So the modal asks for
// device first, then offers the runtime kinds available on that device.

interface RuntimeOption {
  id: number;
  name: string;
  kind: RuntimeKind;
  supported: boolean;
  daemon_id: string;
  device_name: string;
  status: string;
}

interface Props {
  visible: boolean;
  runtimes: RuntimeOption[];
  // UI/UX review #375 follow-up (P1-4 空态 CTA): 父侧 (RuntimesPage 通过
  // BotsTab.openCreate({preselectRuntimeId})) 指定一个 runtime, modal 打开
  // 时跳过 firstReady 自动选, 直接定位到目标 runtime + 它的 device. 用户
  // 在左树某个空 runtime 下点"在此创建"时省去重选 device + runtime 两步.
  preselectRuntimeId?: number | null;
  onClose: () => void;
  onCreated: (botId: number) => void;
}

interface DeviceGroup {
  // Stable composite key for grouping + selection. Same value used as the
  // map key in groupByDevice; we store it on the group so all selection
  // (chip key prop / setDeviceKey / activeGroup find / handleDevicePick)
  // goes through ONE field. daemon_id below is purely for display.
  //
  // Why this matters: review F1 (PR #375) found that using daemon_id alone
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

export function CreateBotModal({ visible, runtimes, preselectRuntimeId, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const [runtimeId, setRuntimeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => groupByDevice(runtimes), [runtimes]);

  // Reset state on open.
  // 优先级:
  //   (1) 父侧传 preselectRuntimeId → 定位到该 runtime + 它的 device
  //       (空态 CTA 入口: 用户在左树 Level-3 某个空 runtime 下点"在此创建")
  //   (2) 否则走 firstReady (有 supported+online runtime 的第一个 device)
  //   (3) 否则随便选第一个 device, runtime 留空
  useEffect(() => {
    if (!visible) return;
    setName('');
    setBusy(false);
    if (preselectRuntimeId != null) {
      const targetGroup = groups.find(g => g.runtimes.some(r => r.id === preselectRuntimeId));
      if (targetGroup) {
        setDeviceKey(targetGroup.key);
        // R1-2 (cc+codex review #PR-3): 校验 target runtime 是否
        // supported+online. 是 → 预选; 否 → 走 firstReady 同款逻辑选该
        // device 第一个可用 runtime, 避免出现 "选中态 + radio disabled +
        // 创建按钮灰" 的矛盾死胡同 (空态 CTA 在 offline / unsupported
        // runtime 下也会出现, 不能信任 preselect 一定可用).
        const target = targetGroup.runtimes.find(r => r.id === preselectRuntimeId);
        if (target && target.supported && target.status === 'online') {
          setRuntimeId(preselectRuntimeId);
        } else {
          const fallback = targetGroup.runtimes.find(r => r.supported && r.status === 'online');
          setRuntimeId(fallback?.id ?? null);
        }
        return;
      }
      // preselect runtime 不在 groups 里 (e.g. 数据未同步) — 静默 fallback
      // 到 firstReady, 不让用户卡在错误的 modal 状态.
    }
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
  }, [visible, groups, preselectRuntimeId]);

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
    setBusy(true);
    try {
      const bot = await createBot({
        runtime_id: selectedRuntime.id,
        name: name.trim(),
        runtime_kind: selectedRuntime.kind,
      });
      Toast.success(`已创建：${bot.name}`);
      onCreated(bot.id);
      onClose();
    } catch (e: any) {
      Toast.error(`创建失败：${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新建 Bot"
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={busy ? '创建中…' : '创建'}
      okButtonProps={{ disabled: !canSubmit }}
      maskClosable={!busy}
      width={520}
    >
      <div className="wk-rt-cb__form">
        <div className="wk-rt-cb__field">
          <label className="wk-rt-cb__label">名称</label>
          <input
            className="wk-rt-cb__input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="如：dev / reviewer / writer"
            disabled={busy}
            autoFocus
            maxLength={64}
          />
        </div>

        <div className="wk-rt-cb__field">
          <label className="wk-rt-cb__label">设备</label>
          {groups.length === 0 ? (
            <div className="wk-rt-cb__empty">
              暂无可用设备。请先创建 Runtime（点上方 + → 创建 Runtime）。
            </div>
          ) : (
            <div className="wk-rt-cb__chips" role="radiogroup" aria-label="选择设备">
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
                      {g.runtimes.filter(r => r.status === 'online').length}/{g.runtimes.length} 在线
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="wk-rt-cb__field">
          <label className="wk-rt-cb__label">运行时</label>
          {!activeGroup ? (
            <div className="wk-rt-cb__empty">先选择设备</div>
          ) : (
            <div className="wk-rt-cb__rt-list" role="radiogroup" aria-label="选择运行时">
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
                      {isOnline ? '在线' : '离线'}
                    </span>
                    {!r.supported && (
                      <span className="wk-rt-cb__rt-tag">暂不支持</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {selectedRuntime?.supported && selectedRuntime.kind === 'openclaw' && (
          <div className="wk-rt-cb__hint">
            openclaw workspace 名将自动派生
          </div>
        )}
      </div>
    </Modal>
  );
}
