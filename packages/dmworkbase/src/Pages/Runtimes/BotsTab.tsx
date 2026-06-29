import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import WKApp from '../../App';
import { Bot, botStatusLabel, isSupportedRuntimeKind, listBots, apiOrigin } from './botsApi';
import { CreateBotModal } from './CreateBotModal';
import { BotDetailPanel } from './BotDetailPanel';
import { useI18n } from '../../i18n';

interface RuntimeListEntry {
  id: number;
  name: string;
  provider: string;
  // PR-2: device grouping for the create-bot 2-step selector. Same kind
  // can have multiple instances across devices (one daemon contributes
  // its own set of runtimes — openclaw / claude), so the user must first
  // pick a device, then a runtime kind under that device. Without this
  // disambiguation the create-bot SELECT would silently bind to whichever
  // "openclaw" entry happened to be first.
  daemon_id: string;
  device_name: string;
  status: string;
}

// Imperative handle exposed to RuntimesPage so the parent can render the
// "+ 新建" CTA up in the shared page header (next to the tabs) while the
// modal state and bot list remain owned by this component. openBot is
// invoked when the user clicks a bot row inside a Runtime's detail page —
// the parent switches the active tab to "bots" and then asks us to
// surface that bot's detail panel.
//
// caster 2026-06-12: openCreate 的 preselectRuntimeId 参数删 — 左树
// Level-3 空态 CTA ("在此创建") 已随 "没 bot 不可展开" 改动移除, 唯一
// caller 消失 (死链路清理). 将来有 runtime 行创建入口再加回.
export interface BotsTabHandle {
  openCreate: () => void | Promise<void>;
  openBot: (id: number) => void;
}

// PR-2: cc-channel-octo (claude) adapter 已落地 +
// 本机 ~/.cc-channel-octo 已切本地 server, 开放 claude 创建. 本期已从
// 全栈移除 codex/hermes, 平台只放行 claude + openclaw (单源守卫见
// botsApi.ts isSupportedRuntimeKind / SUPPORTED_RUNTIME_KINDS).
//
// claude 跟 openclaw 走两条不同的执行路径:
//   - openclaw → 经 daemon adapter Provision (internal/adapter/openclaw.go)
//   - claude   → 不经 daemon adapter Provision. cc-channel-octo 是用户自
//                己起的独立 gateway 进程 (从 /v1/runtime-onboarding 拿命令
//                启动), 它注册自己的 IM bot_uid 接 WS 收消息, 直接调
//                Claude SDK. 创建 claude bot 时 fleet 不派 provision 给
//                daemon, 派给 cc-channel-octo gateway. 已 e2e 验过.

export interface BotsTabProps {
  // PR-2 (runtime tree UI): when true, only the create modal is rendered
  // — the bot list / detail panel UI stays mounted but hidden so the
  // RuntimesPage can keep using `ref.current.openCreate()` from its
  // top-level "+" popover. The bot list is now surfaced inline under
  // each runtime row in the tree, so the standalone tab body is no
  // longer shown by default.
  hidden?: boolean;
  // PR-2 C1: 创建成功后通知父组件 (RuntimesPage), 让父刷
  // 该 runtime 在左树 Level-3 的 bot cache —— BotsTab 自己只管自己那套
  // bots state, 不知道父侧 botsByRuntime 缓存的存在.
  onBotCreated?: (bot: Bot) => void;
}

export const BotsTab = forwardRef<BotsTabHandle, BotsTabProps>(function BotsTab(props, ref) {
  const { t } = useI18n();
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeListEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // C10 in-flight guard: spaceEpoch 每次 space-changed 自增, refresh /
  // loadRuntimes 启动时拍快照, 响应回来时若 epoch 变了就丢弃 — 防旧
  // space 的请求覆盖新 space 的 setRuntimes/setBots.
  const spaceEpochRef = useRef(0);

  // 同 space 内的请求序号 (跟 RuntimesPage.loadData 的 loadSeq 同模式)。
  // loadRuntimes 可能被 mount / space-change / openCreate 并发触发,fetch 响应
  // 顺序不保证;只让最新一次请求 setRuntimes,防早发晚归的请求覆盖成旧列表。
  const loadRuntimesSeqRef = useRef(0);

  // When a parent calls openBot(id) before the bots list has loaded, we
  // stash the id here and let a [bots]-watching effect apply it once the
  // list arrives. Without this, jumping in from a Runtime detail page on
  // first render silently does nothing.
  const pendingOpenIdRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const epoch = spaceEpochRef.current;
    setLoading(true);
    try {
      const list = await listBots();
      if (epoch !== spaceEpochRef.current) return; // stale
      setBots(list);
    } finally {
      if (epoch === spaceEpochRef.current) setLoading(false);
    }
  }, []);

  // Load runtimes for the create modal —— 必须跟 space 同步, 否则切 space 后
  // create bot 弹窗仍用旧 space 的设备/runtime, 导致跨 space mint 失败. 用
  // mittBus 监听 space-changed (跟 RuntimesPage 同源信号), 命中时重拉.
  const loadRuntimes = useCallback(async () => {
    const epoch = spaceEpochRef.current;
    const seq = ++loadRuntimesSeqRef.current;
    const spaceId = (WKApp as any)?.shared?.currentSpaceId ?? '';
    const sessionToken = (WKApp as any)?.loginInfo?.token ?? '';
    // 合并 plan 决策一+二 Phase 3A: fleet 切到 AuthMiddleware 接 session
    // token, 直接带 `token:` header 调 (跟 matter user-auth 一致).
    try {
      const headers: Record<string, string> = {};
      if (sessionToken) headers.token = sessionToken;
      if (spaceId) headers['X-Space-Id'] = spaceId;
      const res = await fetch(`${apiOrigin()}/fleet/api/v1/runtimes?space_id=` + encodeURIComponent(spaceId), {
        headers,
      });
      const env = await res.json();
      // stale: 切了 space (epoch) 或被更新的 loadRuntimes 请求超越 (seq) 都丢弃
      if (epoch !== spaceEpochRef.current || seq !== loadRuntimesSeqRef.current) return;
      const list = (env?.data?.runtimes ?? env?.runtimes ?? []) as any[];
      setRuntimes(list.map(r => ({
        id: r.id,
        name: r.name || r.provider,
        provider: r.provider,
        daemon_id: r.daemon_id || '',
        device_name: r.device_name || r.daemon_id || 'unknown',
        status: r.status || 'unknown',
      })));
    } catch {
      if (epoch === spaceEpochRef.current && seq === loadRuntimesSeqRef.current) setRuntimes([]);
    }
  }, []);

  useEffect(() => { loadRuntimes() }, [loadRuntimes]);

  // 切 space 时清除 bot 列表 + 重拉 runtimes; 同时关弹窗 / 清挂起的 openBot,
  // 防止跨 space 的 bot id 撞到当前列表. epoch++ 让在飞的 refresh /
  // loadRuntimes 回填时被识别成 stale 丢弃 (C10).
  useEffect(() => {
    const onSpaceChanged = () => {
      spaceEpochRef.current++;
      setBots([]);
      setSelectedId(null);
      setModalOpen(false);
      pendingOpenIdRef.current = null;
      loadRuntimes();
      refresh();
    };
    (WKApp as any).mittBus?.on?.('space-changed', onSpaceChanged);
    return () => {
      (WKApp as any).mittBus?.off?.('space-changed', onSpaceChanged);
    };
  }, [loadRuntimes, refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  // Light 5s polling so status transitions (provisioning → active) appear.
  // PR-2: hidden 时跳轮询, 否则 RuntimesPage 用 ref
  // 持有的 hidden BotsTab 也每 5s 全量 listBots(), 跟 RuntimesPage 自己的
  // refreshRuntimeBots 是两路并发. hidden 时左树 Level-3 已经走父侧的
  // refreshRuntimeBots 单源, 这条 polling 是冗余.
  useEffect(() => {
    if (props.hidden) return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, props.hidden]);

  // Selecting a bot pushes the detail to the right pane (same mechanism
  // RuntimesPage uses for agent detail — keeps RuntimesPage as a pure
  // left-sidebar list and stays consistent with the WKApp two-pane router).
  const selectBot = useCallback((bot: Bot) => {
    setSelectedId(bot.id);
    (WKApp as any).routeRight.replaceToRoot(
      <BotDetailPanel bot={bot} />,
    );
  }, []);

  useImperativeHandle(ref, () => ({
    openCreate: async () => {
      // 刷新弹窗用的 runtime 缓存再开 —— hidden 的 BotsTab 不轮询 (见下方 polling
      // effect),runtimes 只在 mount / 切 space 时拉过。用户「先装运行时→等菜单变
      // 可点→点创建」时,本缓存仍是装之前的(无/离线)数据,弹窗 runtime 选择器为空
      // 导致建不了 bot。await 后再开,确保弹窗一上来就是刷新后的列表,不会先用旧
      // (尤其首屏空)缓存渲染再跳变。loadRuntimes 内有
      // try/catch + epoch guard,不会 reject、不会跨 space 回填。
      const epoch = spaceEpochRef.current;
      await loadRuntimes();
      // await 期间可能切了 space (onSpaceChanged 已 setModalOpen(false))——epoch 变了
      // 就别在新 space 里用旧调用重开弹窗。
      if (epoch !== spaceEpochRef.current) return;
      setModalOpen(true);
    },
    openBot: (id: number) => {
      const found = bots.find(b => b.id === id);
      if (found) {
        selectBot(found);
      } else {
        // List not loaded yet (or stale). Park the id and let the
        // [bots] effect below pick it up on the next list arrival.
        // hidden 时关了 5s polling,
        // bots 不会自动更新 → 必须主动触发一次 refresh, 否则 pending
        // id 永远落不到任何后续 [bots] tick 上, bot 永远打不开.
        pendingOpenIdRef.current = id;
        refresh();
      }
    },
  }), [bots, selectBot, refresh, loadRuntimes]);

  // Apply any parked openBot request once the bots list (or a refresh)
  // delivers the matching entry. Cleared regardless of match — a missing
  // id is most likely an archived/deleted bot and shouldn't keep firing.
  useEffect(() => {
    const pending = pendingOpenIdRef.current;
    if (pending == null) return;
    const found = bots.find(b => b.id === pending);
    if (found) {
      pendingOpenIdRef.current = null;
      selectBot(found);
    } else if (!loading && bots.length > 0) {
      pendingOpenIdRef.current = null;
    }
  }, [bots, loading, selectBot]);

  const modalRuntimes = useMemo(() => runtimes.map(r => ({
    id: r.id,
    name: r.name,
    kind: r.provider,
    supported: isSupportedRuntimeKind(r.provider),
    daemon_id: r.daemon_id,
    device_name: r.device_name,
    status: r.status,
  })), [runtimes]);

  const handleCreated = useCallback(async (botId: number) => {
    // C10: handleCreated 内 await 链同样要 epoch guard, 否则切 space 中
    // 创建成功后旧响应 setBots / selectBot 旧 space 的 bot.
    //
    // 单次 listBots 即可 — refresh() 内部已经
    // 调一次 listBots+setBots, 后面再独立 listBots 是冗余 fetch. 改成只
    // 调一次, 直接拿到结果用 (refresh 同时也更新 state).
    const epoch = spaceEpochRef.current;
    setSelectedId(botId);
    const fresh = await listBots();
    if (epoch !== spaceEpochRef.current) return;
    setBots(fresh);
    const created = fresh.find(b => b.id === botId);
    if (created) {
      selectBot(created);
      // C1: 让左树 Level-3 缓存失效, RuntimesPage 在 onBotCreated 里
      // refreshRuntimeBots(runtime_id) 重新拉新 list (含刚建的 bot).
      props.onBotCreated?.(created);
    }
  }, [selectBot, props.onBotCreated]);

  return (
    <div className="wk-rt-bots-list" style={props.hidden ? { display: 'none' } : undefined}>
      {loading && bots.length === 0 && <div className="wk-rt-bots__empty">{t("base.runtimes.common.loading")}</div>}
      {!loading && bots.length === 0 && (
        <div className="wk-rt-bots__empty">{t("base.runtimes.bots.empty")}</div>
      )}
      <ul className="wk-rt-bots__items">
        {bots.map(b => (
          <li
            key={b.id}
            className={`wk-rt-bots__item${selectedId === b.id ? ' is-active' : ''}`}
            onClick={() => selectBot(b)}
          >
            <div className="wk-rt-bots__item-name">{b.name}</div>
            <div className="wk-rt-bots__item-meta">
              <span className="wk-rt-bots__item-kind">{b.runtime_kind}</span>
              <span className={`wk-rt-bots__item-status wk-rt-bots__item-status--${b.status}`}>
                {botStatusLabel(b.status)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <CreateBotModal
        visible={modalOpen}
        runtimes={modalRuntimes}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
});
