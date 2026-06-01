import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WKApp from '../../App';
import { Bot, listBots, RuntimeKind } from './botsApi';
import { CreateBotModal } from './CreateBotModal';
import { BotDetailPanel } from './BotDetailPanel';

interface RuntimeListEntry {
  id: number;
  name: string;
  provider: string;
}

// PoC4: which runtime kinds actually run tasks. Others are inert.
const SUPPORTED_KINDS: RuntimeKind[] = ['openclaw'];

export function BotsTab() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeListEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBots();
      setBots(list);
      setSelectedId(prev => prev ?? (list[0]?.id ?? null));
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

  const modalRuntimes = useMemo(() => runtimes.map(r => ({
    id: r.id,
    name: r.name,
    kind: (r.provider as RuntimeKind),
    supported: SUPPORTED_KINDS.includes(r.provider as RuntimeKind),
  })), [runtimes]);

  const handleCreated = useCallback((botId: number) => {
    setSelectedId(botId);
    refresh();
  }, [refresh]);

  const selected = bots.find(b => b.id === selectedId) ?? null;

  return (
    <div className="wk-rt-bots">
      <div className="wk-rt-bots__list">
        <div className="wk-rt-bots__list-header">
          <span>智能体 {bots.length > 0 && <span className="wk-rt-bots__count">{bots.length}</span>}</span>
          <button type="button" className="wk-rt-bots__new" onClick={() => setModalOpen(true)}>
            + 新建
          </button>
        </div>
        {loading && bots.length === 0 && <div className="wk-rt-bots__empty">加载中…</div>}
        {!loading && bots.length === 0 && (
          <div className="wk-rt-bots__empty">还没有智能体，点上方 + 新建</div>
        )}
        <ul className="wk-rt-bots__items">
          {bots.map(b => (
            <li
              key={b.id}
              className={`wk-rt-bots__item${selectedId === b.id ? ' is-active' : ''}`}
              onClick={() => setSelectedId(b.id)}
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
      </div>
      <div className="wk-rt-bots__detail">
        {selected ? <BotDetailPanel bot={selected} onArchived={refresh} /> :
          <div className="wk-rt-bots__detail-empty">从左侧选择一个智能体</div>}
      </div>
      <CreateBotModal
        visible={modalOpen}
        runtimes={modalRuntimes}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
