import React, { useCallback, useEffect, useState } from 'react';
import { Bot, BotFeedItem, archiveBot, getBotFeed } from './botsApi';

type DetailTab = 'info' | 'feed' | 'tasks' | 'skills';

export function BotDetailPanel({ bot, onArchived }: { bot: Bot; onArchived: () => void }) {
  const [tab, setTab] = useState<DetailTab>('info');
  return (
    <div className="wk-rt-botdetail">
      <header className="wk-rt-botdetail__header">
        <div className="wk-rt-botdetail__avatar" aria-hidden="true">
          {bot.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="wk-rt-botdetail__title">
          <div className="wk-rt-botdetail__name">{bot.name}</div>
          <div className="wk-rt-botdetail__sub">
            <span className={`wk-rt-botdetail__status wk-rt-botdetail__status--${bot.status}`}>
              {bot.status === 'active' ? '● 在线' :
               bot.status === 'failed' ? '● 失败' :
               '● 初始化中'}
            </span>
            <span className="wk-rt-botdetail__kind">{bot.runtime_kind}</span>
          </div>
        </div>
        <button
          type="button"
          className="wk-rt-botdetail__archive"
          onClick={() => {
            if (!window.confirm(`归档 ${bot.name}？`)) return;
            archiveBot(bot.id).then(onArchived).catch(() => {});
          }}
        >归档</button>
      </header>

      <nav className="wk-rt-botdetail__tabs">
        {(['info','feed','tasks','skills'] as DetailTab[]).map(t => (
          <button
            key={t}
            type="button"
            className={`wk-rt-botdetail__tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'info' ? '基本信息' : t === 'feed' ? '动态' : t === 'tasks' ? 'Tasks' : 'Skills'}
          </button>
        ))}
      </nav>

      <div className="wk-rt-botdetail__body">
        {tab === 'info' && <InfoTab bot={bot} />}
        {tab === 'feed' && <FeedTab bot={bot} />}
        {tab === 'tasks' && <TasksTab bot={bot} />}
        {tab === 'skills' && <SkillsTab />}
      </div>
    </div>
  );
}

function InfoTab({ bot }: { bot: Bot }) {
  const rows: [string, React.ReactNode][] = [
    ['Name', bot.name],
    ['Runtime', `${bot.runtime_kind} (#${bot.runtime_id})`],
    ['Owner', bot.owner_uid],
    ['Bot UID', <code key="u">{bot.bot_uid || '—'}</code>],
    ['Workspace', bot.workspace_id ? <code key="w">{bot.workspace_id}</code> : <span style={{ color: '#aaa' }} key="w">—</span>],
    ['Daemon', bot.daemon_id || '—'],
    ['Status', bot.status],
    ['Created', bot.created_at],
    ['Updated', bot.updated_at],
  ];
  if (bot.error_msg) rows.push(['Error', <span style={{ color: '#dc2626' }} key="e">{bot.error_msg}</span>]);
  return (
    <dl className="wk-rt-botdetail__props">
      {rows.map(([k, v]) => (
        <React.Fragment key={k as string}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function FeedTab({ bot }: { bot: Bot }) {
  const [items, setItems] = useState<BotFeedItem[] | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await getBotFeed(bot.id, 50);
      setItems(data);
    } catch {
      setItems([]);
    }
  }, [bot.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [load]);
  if (items === null) return <div className="wk-rt-botdetail__empty">加载中…</div>;
  if (items.length === 0) return <div className="wk-rt-botdetail__empty">暂无动态</div>;
  return (
    <ul className="wk-rt-botdetail__feed">
      {items.map(it => (
        <li key={`${it.kind}-${it.id}`} className={`wk-rt-botdetail__feed-${it.kind}`}>
          <span className="wk-rt-botdetail__feed-time">{formatTime(it.created_at)}</span>
          <span className="wk-rt-botdetail__feed-matter">matter {it.matter_id.slice(0, 8)}</span>
          <span className="wk-rt-botdetail__feed-body">
            {it.kind === 'comment'
              ? (it.content || '').slice(0, 140)
              : `${it.action} ${detailSummary(it.detail)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TasksTab({ bot }: { bot: Bot }) {
  const [items, setItems] = useState<BotFeedItem[] | null>(null);
  useEffect(() => {
    getBotFeed(bot.id, 100)
      .then(data => setItems(data.filter(i => i.kind === 'activity' && i.action?.startsWith('agent_task'))))
      .catch(() => setItems([]));
  }, [bot.id]);
  if (items === null) return <div className="wk-rt-botdetail__empty">加载中…</div>;
  if (items.length === 0) return <div className="wk-rt-botdetail__empty">还没有任务记录</div>;
  return (
    <table className="wk-rt-botdetail__tasks">
      <thead>
        <tr><th>时间</th><th>状态</th><th>耗时</th><th>matter</th></tr>
      </thead>
      <tbody>
        {items.map(t => {
          const ok = t.action === 'agent_task_completed';
          const elapsed = (t.detail?.elapsed_ms as number | undefined);
          return (
            <tr key={t.id}>
              <td>{formatTime(t.created_at)}</td>
              <td style={{ color: ok ? '#0a8a4f' : '#dc2626' }}>
                {ok ? '✓ 完成' : '✗ 失败'}
              </td>
              <td>{elapsed ? `${(elapsed / 1000).toFixed(1)}s` : '—'}</td>
              <td><code>{t.matter_id.slice(0, 8)}</code></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SkillsTab() {
  return <div className="wk-rt-botdetail__empty">Skills 配置 — PoC4 范围外，待实现</div>;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function detailSummary(detail?: Record<string, unknown>): string {
  if (!detail) return '';
  if (typeof detail.bytes === 'number') return `· ${detail.bytes} 字节`;
  if (typeof detail.error === 'string') return `· ${String(detail.error).slice(0, 60)}`;
  return '';
}
