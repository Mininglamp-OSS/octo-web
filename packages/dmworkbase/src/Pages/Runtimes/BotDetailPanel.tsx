import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, BotFeedItem, archiveBot, getBotFeed } from './botsApi';

type DetailTab = 'info' | 'feed' | 'tasks' | 'skills';

// Deterministic, low-saturation color derived from bot name. Keeps the
// page calm (memory: feedback_ui_style — no strong colors, no gradients)
// while still giving each bot a recognizable hue at a glance.
const AVATAR_PALETTE = [
  { bg: '#eef2f7', fg: '#3d4759' },
  { bg: '#eef5ee', fg: '#365940' },
  { bg: '#f5eef0', fg: '#5a3d4a' },
  { bg: '#f0f0f5', fg: '#3d3d5c' },
  { bg: '#f5f1e8', fg: '#5c4a2d' },
  { bg: '#e8f1f5', fg: '#2d4a5c' },
];

function avatarColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function BotDetailPanel({ bot, onArchived }: { bot: Bot; onArchived: () => void }) {
  const [tab, setTab] = useState<DetailTab>('info');
  const av = avatarColor(bot.name);
  const statusKind: 'online' | 'failed' | 'pending' =
    bot.status === 'active' ? 'online' :
    bot.status === 'failed' ? 'failed' : 'pending';
  const statusLabel =
    bot.status === 'active' ? '在线' :
    bot.status === 'failed' ? '失败' : '初始化中';

  return (
    <div className="wk-bd">
      {/* ── Header ────────────────────────────────────────── */}
      <header className="wk-bd-header">
        <div
          className="wk-bd-avatar"
          style={{ background: av.bg, color: av.fg }}
          aria-hidden="true"
        >
          {bot.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="wk-bd-headinfo">
          <h1 className="wk-bd-name">{bot.name}</h1>
          <div className="wk-bd-meta">
            <span className={`wk-bd-status wk-bd-status--${statusKind}`}>
              <span className="wk-bd-status__dot" aria-hidden="true" />
              {statusLabel}
            </span>
            <span className="wk-bd-chip wk-bd-chip--kind">{bot.runtime_kind}</span>
            {bot.workspace_id && <span className="wk-bd-chip wk-bd-chip--ws">{bot.workspace_id}</span>}
          </div>
        </div>
        <div className="wk-bd-actions">
          <button
            type="button"
            className="wk-bd-action wk-bd-action--ghost"
            onClick={() => {
              if (!window.confirm(`归档 ${bot.name}？`)) return;
              archiveBot(bot.id).then(onArchived).catch(() => {});
            }}
            title="归档智能体"
          >归档</button>
        </div>
      </header>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <nav className="wk-bd-tabs" role="tablist" aria-label="智能体详情切换">
        {(['info','feed','tasks','skills'] as DetailTab[]).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`wk-bd-tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'info' ? '基本信息' : t === 'feed' ? '动态' : t === 'tasks' ? 'Tasks' : 'Skills'}
          </button>
        ))}
      </nav>

      {/* ── Body ──────────────────────────────────────────── */}
      <div className="wk-bd-body">
        {tab === 'info' && <InfoTab bot={bot} />}
        {tab === 'feed' && <FeedTab bot={bot} />}
        {tab === 'tasks' && <TasksTab bot={bot} />}
        {tab === 'skills' && <SkillsTab />}
      </div>
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────

function InfoTab({ bot }: { bot: Bot }) {
  return (
    <div className="wk-bd-section">
      <h3 className="wk-bd-section__title">配置</h3>
      <dl className="wk-bd-props">
        <PropRow label="Runtime" value={
          <>
            <span className="wk-bd-mono">{bot.runtime_kind}</span>
            <span className="wk-bd-props__sep">·</span>
            <span className="wk-bd-props__hint">#{bot.runtime_id}</span>
          </>
        } />
        <PropRow label="所有者" value={<Copyable text={bot.owner_uid} mono />} />
        <PropRow label="状态" value={<span className="wk-bd-mono">{bot.status}</span>} />
        {bot.workspace_id && <PropRow label="Workspace" value={<Copyable text={bot.workspace_id} mono />} />}
      </dl>
      <h3 className="wk-bd-section__title wk-bd-section__title--secondary">身份</h3>
      <dl className="wk-bd-props">
        <PropRow label="Bot UID" value={<Copyable text={bot.bot_uid} mono />} />
        <PropRow label="Daemon" value={<Copyable text={bot.daemon_id} mono />} />
        <PropRow label="创建于" value={<span className="wk-bd-props__time">{bot.created_at}</span>} />
        <PropRow label="更新于" value={<span className="wk-bd-props__time">{bot.updated_at}</span>} />
      </dl>
      {bot.error_msg && (
        <div className="wk-bd-callout wk-bd-callout--err">
          <span className="wk-bd-callout__label">最近错误</span>
          <span className="wk-bd-callout__body">{bot.error_msg}</span>
        </div>
      )}
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="wk-bd-prop">
      <dt className="wk-bd-prop__label">{label}</dt>
      <dd className="wk-bd-prop__value">{value}</dd>
    </div>
  );
}

function Copyable({ text, mono = false }: { text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span className={`wk-bd-copyable${mono ? ' is-mono' : ''}`} title={text}>
      <span className="wk-bd-copyable__text">{text || '—'}</span>
      {text && (
        <button
          type="button"
          className="wk-bd-copyable__btn"
          onClick={onCopy}
          aria-label="复制"
        >{copied ? '✓' : '⧉'}</button>
      )}
    </span>
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

  const stats = useMemo(() => {
    if (!items) return null;
    const tasks = items.filter(i => i.kind === 'activity' && i.action?.startsWith('agent_task'));
    const completed = tasks.filter(i => i.action === 'agent_task_completed').length;
    const failed = tasks.filter(i => i.action === 'agent_task_failed').length;
    const total = completed + failed;
    const successPct = total > 0 ? Math.round((completed / total) * 100) : null;
    const avgMs = (() => {
      const els = tasks
        .map(t => t.detail?.elapsed_ms as number | undefined)
        .filter((n): n is number => typeof n === 'number' && n > 0);
      if (els.length === 0) return null;
      return Math.round(els.reduce((a, b) => a + b, 0) / els.length);
    })();
    return { total, completed, failed, successPct, avgMs };
  }, [items]);

  if (items === null) return <div className="wk-bd-empty">加载中…</div>;

  return (
    <>
      {/* Recent performance card */}
      {stats && stats.total > 0 && (
        <section className="wk-bd-section wk-bd-section--card">
          <h3 className="wk-bd-section__title">表现</h3>
          <div className="wk-bd-stats">
            <div className="wk-bd-stats__col">
              <div className="wk-bd-stats__big">{stats.total}</div>
              <div className="wk-bd-stats__sub">次运行</div>
            </div>
            {stats.successPct !== null && (
              <div className="wk-bd-stats__col">
                <div className="wk-bd-stats__big">{stats.successPct}%</div>
                <div className="wk-bd-stats__sub">成功率</div>
              </div>
            )}
            {stats.avgMs !== null && (
              <div className="wk-bd-stats__col">
                <div className="wk-bd-stats__big">{(stats.avgMs / 1000).toFixed(1)}<span className="wk-bd-stats__unit">s</span></div>
                <div className="wk-bd-stats__sub">平均耗时</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Activity feed */}
      <section className="wk-bd-section wk-bd-section--card">
        <h3 className="wk-bd-section__title">动态</h3>
        {items.length === 0 ? (
          <div className="wk-bd-empty wk-bd-empty--inline">暂无动态</div>
        ) : (
          <ul className="wk-bd-feed">
            {items.map(it => (
              <li key={`${it.kind}-${it.id}`} className={`wk-bd-feed__row wk-bd-feed__row--${it.kind}`}>
                <span className={`wk-bd-feed__dot wk-bd-feed__dot--${dotKind(it)}`} aria-hidden="true" />
                <div className="wk-bd-feed__main">
                  <div className="wk-bd-feed__title">
                    {it.kind === 'comment'
                      ? (it.content || '').slice(0, 200)
                      : agentActionLabel(it.action, it.detail)}
                  </div>
                  <div className="wk-bd-feed__meta">
                    <span>{matterLabel(it)}</span>
                    <span className="wk-bd-feed__dotsep">·</span>
                    <span className="wk-bd-feed__time">{formatTime(it.created_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function TasksTab({ bot }: { bot: Bot }) {
  const [items, setItems] = useState<BotFeedItem[] | null>(null);
  useEffect(() => {
    getBotFeed(bot.id, 100)
      .then(data => setItems(data.filter(i => i.kind === 'activity' && i.action?.startsWith('agent_task'))))
      .catch(() => setItems([]));
  }, [bot.id]);
  if (items === null) return <div className="wk-bd-empty">加载中…</div>;
  if (items.length === 0) return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">任务记录</h3>
      <div className="wk-bd-empty wk-bd-empty--inline">还没有任务记录 — 在事项里 @ 此智能体即可派任务</div>
    </section>
  );
  return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">任务记录 <span className="wk-bd-section__count">{items.length}</span></h3>
      <ul className="wk-bd-tasks">
        {items.map(t => {
          const ok = t.action === 'agent_task_completed';
          const elapsed = (t.detail?.elapsed_ms as number | undefined);
          const bytes = (t.detail?.bytes as number | undefined);
          const err = (t.detail?.error as string | undefined);
          return (
            <li key={t.id} className={`wk-bd-task${ok ? '' : ' wk-bd-task--failed'}`}>
              <span className={`wk-bd-task__icon wk-bd-task__icon--${ok ? 'ok' : 'fail'}`} aria-hidden="true">
                {ok ? '✓' : '✗'}
              </span>
              <div className="wk-bd-task__main">
                <div className="wk-bd-task__title">{matterLabel(t)}</div>
                <div className="wk-bd-task__meta">
                  <span>{formatTime(t.created_at)}</span>
                  {elapsed != null && <><span>·</span><span>{(elapsed / 1000).toFixed(1)}s</span></>}
                  {bytes != null && bytes > 0 && <><span>·</span><span>{bytes} 字节</span></>}
                  {err && <><span>·</span><span className="wk-bd-task__err">{err.slice(0, 80)}</span></>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SkillsTab() {
  return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">Skills</h3>
      <div className="wk-bd-empty wk-bd-empty--inline">Skills 配置（占位 — 下个迭代）</div>
    </section>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dotKind(it: BotFeedItem): 'comment' | 'ok' | 'fail' | 'info' {
  if (it.kind === 'comment') return 'comment';
  if (it.action === 'agent_task_completed') return 'ok';
  if (it.action === 'agent_task_failed') return 'fail';
  return 'info';
}

function agentActionLabel(action?: string, detail?: Record<string, unknown>): string {
  if (!action) return '';
  switch (action) {
    case 'agent_dispatched':
      return '派发任务';
    case 'agent_task_completed': {
      const ms = (detail?.elapsed_ms as number | undefined);
      const bytes = (detail?.bytes as number | undefined);
      const t = ms != null ? `${(ms / 1000).toFixed(1)}s` : '';
      const b = bytes != null && bytes > 0 ? `${bytes} 字节` : '';
      return `完成任务${t || b ? ' · ' : ''}${[t, b].filter(Boolean).join(' · ')}`;
    }
    case 'agent_task_failed':
      return `任务失败 · ${String(detail?.error ?? '').slice(0, 60)}`;
    default:
      return action;
  }
}

function matterLabel(it: BotFeedItem): string {
  if (it.matter_seq_no && it.matter_title) return `M-${it.matter_seq_no} ${it.matter_title}`;
  if (it.matter_seq_no) return `M-${it.matter_seq_no}`;
  return `matter ${it.matter_id.slice(0, 8)}`;
}
