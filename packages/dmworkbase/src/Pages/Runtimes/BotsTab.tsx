import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import WKApp from '../../App';
import { Bot, listBots, RuntimeKind } from './botsApi';
import { CreateBotModal } from './CreateBotModal';
import { BotDetailPanel } from './BotDetailPanel';

interface RuntimeListEntry {
  id: number;
  name: string;
  provider: string;
}

// Imperative handle exposed to RuntimesPage so the parent can render the
// "+ 新建" CTA up in the shared page header (next to the tabs) while the
// modal state and bot list remain owned by this component. openBot is
// invoked when the user clicks a bot row inside a Runtime's detail page —
// the parent switches the active tab to "bots" and then asks us to
// surface that bot's detail panel.
export interface BotsTabHandle {
  openCreate: () => void;
  openBot: (id: number) => void;
}

// PoC4: which runtime kinds actually run tasks. Others are inert.
const SUPPORTED_KINDS: RuntimeKind[] = ['openclaw'];

export const BotsTab = forwardRef<BotsTabHandle>(function BotsTab(_props, ref) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeListEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // When a parent calls openBot(id) before the bots list has loaded, we
  // stash the id here and let a [bots]-watching effect apply it once the
  // list arrives. Without this, jumping in from a Runtime detail page on
  // first render silently does nothing.
  const pendingOpenIdRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBots();
      setBots(list);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load runtimes once for the create modal.
  useEffect(() => {
    const spaceId = (WKApp as any)?.shared?.currentSpaceId ?? '';
    const token = (WKApp as any)?.loginInfo?.token ?? '';
    fetch('/api/v1/runtimes?space_id=' + encodeURIComponent(spaceId), {
      headers: { token },
    })
      .then(r => r.json())
      .then(env => {
        const list = (env?.data?.runtimes ?? env?.runtimes ?? []) as any[];
        setRuntimes(list.map(r => ({ id: r.id, name: r.name || r.provider, provider: r.provider })));
      })
      .catch(() => setRuntimes([]));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Light 5s polling so status transitions (provisioning → active) appear.
  useEffect(() => {
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // Selecting a bot pushes the detail to the right pane (same mechanism
  // RuntimesPage uses for agent detail — keeps RuntimesPage as a pure
  // left-sidebar list and stays consistent with the WKApp two-pane router).
  const selectBot = useCallback((bot: Bot) => {
    setSelectedId(bot.id);
    (WKApp as any).routeRight.replaceToRoot(
      <BotDetailPanel bot={bot} onArchived={refresh} />,
    );
  }, [refresh]);

  useImperativeHandle(ref, () => ({
    openCreate: () => setModalOpen(true),
    openBot: (id: number) => {
      const found = bots.find(b => b.id === id);
      if (found) {
        selectBot(found);
      } else {
        // List not loaded yet (or stale). Park the id and let the
        // [bots] effect below pick it up on the next list arrival.
        pendingOpenIdRef.current = id;
      }
    },
  }), [bots, selectBot]);

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
    kind: (r.provider as RuntimeKind),
    supported: SUPPORTED_KINDS.includes(r.provider as RuntimeKind),
  })), [runtimes]);

  const handleCreated = useCallback(async (botId: number) => {
    setSelectedId(botId);
    await refresh();
    const fresh = await listBots();
    setBots(fresh);
    const created = fresh.find(b => b.id === botId);
    if (created) selectBot(created);
  }, [refresh, selectBot]);

  return (
    <div className="wk-rt-bots-list">
      {loading && bots.length === 0 && <div className="wk-rt-bots__empty">加载中…</div>}
      {!loading && bots.length === 0 && (
        <div className="wk-rt-bots__empty">还没有智能体，点右上角 + 新建</div>
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
                {b.status === 'active' ? '在线' :
                 b.status === 'failed' ? '失败' :
                 (b.status === 'provisioning' || b.status === 'bot_minted' || b.status === 'dispatched') ? '初始化中' :
                 b.status}
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

