import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WKSDK, { Channel, ChannelTypePerson } from 'wukongimjssdk';
import WKApp from '../../App';
import WKAvatar from '../../Components/WKAvatar';
import { Bot, BotFeedItem, getBotFeed } from './botsApi';
import { i18n, t as tt, useI18n } from '../../i18n';

type DetailTab = 'info' | 'feed' | 'tasks' | 'skills';

// matter (任务/数据面) 本期未上线 —— 依赖 matter 的「动态」「任务记录」两个
// tab 改为「待上线」占位 (同时停掉 FeedTab/TasksTab 对 matter feed 的 3s 轮询).
// matter 上线后把 MATTER_ENABLED 置 true 即恢复真实内容.
const MATTER_ENABLED = false;
// 每个 tab 是否已就绪: false → 展示「待上线」占位 + tab 角标.
// Skills 是独立的待开发功能, 跟 matter 无关.
const TAB_READY: Record<DetailTab, boolean> = {
  info: true,
  feed: MATTER_ENABLED,
  tasks: MATTER_ENABLED,
  skills: false,
};

// PR-2: bot 在线信号 = WuKongIM channel.online (跟主 IM 私聊里 bot 头像
// 旁边那个绿点同源). 不是 fleet bot.status / runtime.status —— 那俩是
// fleet 内部状态机, 跟 IM 实际能否通讯无直接关系.
function useChannelOnline(channel: Channel | null): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (!channel) return false;
    const info = WKSDK.shared().channelManager.getChannelInfo(channel);
    return (info?.online as any) === 1 || (info?.online as any) === true;
  });
  useEffect(() => {
    if (!channel) return;
    const read = () => {
      const info = WKSDK.shared().channelManager.getChannelInfo(channel);
      setOnline((info?.online as any) === 1 || (info?.online as any) === true);
    };
    read();
    const t = window.setInterval(read, 2000);
    return () => window.clearInterval(t);
  }, [channel?.channelID, channel?.channelType]);
  return online;
}

export function BotDetailPanel({ bot }: { bot: Bot }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DetailTab>('info');

  // BotDetailPanel 由 WKApp.routeRight.replaceToRoot 命令式挂载, 不在
  // I18nProvider 子树里, useI18n 的 context 永不触发本面板 (及子 tab)
  // 在 locale 实时切换时重渲染. 直接订阅 i18n 单例 + 自我 forceUpdate,
  // 让切语言后 Info/Feed/Tasks/Skills 全部刷新 (subscribe 返回的取消订阅
  // 函数作为 effect cleanup, 卸载时退订).
  const [, forceLocaleRerender] = useState(0);
  useEffect(() => i18n.subscribe(() => forceLocaleRerender(n => n + 1)), []);

  const botChannel = useMemo(
    () => bot.bot_uid ? new Channel(bot.bot_uid, ChannelTypePerson) : null,
    [bot.bot_uid],
  );

  const isOnline = useChannelOnline(botChannel);
  const openChat = () => {
    if (botChannel) {
      (WKApp as any).endpoints?.showConversation?.(botChannel);
    }
  };

  return (
    <div className="wk-bd">
      {/* ── Header ────────────────────────────────────────── */}
      <header className="wk-bd-header">
        <div
          className={`wk-bd-avatar-wrap${botChannel ? ' wk-rt-clickable' : ''}`}
          onClick={botChannel ? openChat : undefined}
          title={botChannel ? t("base.runtimes.botDetail.openDM") : undefined}
        >
          {botChannel ? (
            <WKAvatar
              channel={botChannel}
              style={{ width: 48, height: 48, borderRadius: 8 }}
            />
          ) : (
            <div className="wk-bd-avatar wk-bd-avatar--placeholder" aria-hidden="true">
              {bot.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          {/* PR-2: 跟私聊 bot 头像同款绿点. 信号源 = WuKongIM
              channel.online (channelInfo.online === 1), 跟主 IM 私聊
              列表完全一致, 不是 fleet 的 bot.status — 后者 'active'
              是 fleet 状态机里"已派发完成"的语义, 不等于 IM 真在线. */}
          {isOnline && <span className="wk-rt-online-dot" title={t("base.runtimes.common.online")} />}
        </div>
        <div className="wk-bd-headinfo">
          <h1 className="wk-bd-name">{bot.name}</h1>
          <div className="wk-bd-meta">
            {/* PR-2: 删独立"● 在线"chip, 在线状态走头像旁绿点 (跟私聊一致). */}
            {/* PR-2: 删 workspace_id chip — 是 dev 级实现细节, 用户只
                需要知道 Bot, 它对应的 agent workspace 是后端自动派生
                的 (openclaw workspace 命名 / cc-channel-octo bot dir
                等), 用户没必要看到. */}
            <span className="wk-bd-chip wk-bd-chip--kind">{bot.runtime_kind}</span>
          </div>
        </div>
        {/* PR-2: hide "归档" button until cross-tier deprovision works:
            current archiveBot only flips fleet bot.status=archived; the
            server robot row + WuKongIM channel + daemon-side adapter
            resources (openclaw workspace, cc-channel-octo bot config)
            are NOT cleaned up — leaving stale state
            on multiple ends. Restore once adapter.Deprovision is
            implemented end-to-end across runtimes (the daemon-side
            interface is in place; claude still TODO). */}
      </header>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <nav className="wk-bd-tabs" role="tablist" aria-label={t("base.runtimes.botDetail.tabsAria")}>
        {(['info','feed','tasks','skills'] as DetailTab[]).map(tabKey => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            className={`wk-bd-tab${tab === tabKey ? ' is-active' : ''}`}
            onClick={() => setTab(tabKey)}
          >
            {tabKey === 'info' ? t("base.runtimes.botDetail.tabInfo") : tabKey === 'feed' ? t("base.runtimes.botDetail.tabFeed") : tabKey === 'tasks' ? t("base.runtimes.botDetail.tabTasks") : t("base.runtimes.botDetail.tabSkills")}
            {!TAB_READY[tabKey] && <span className="wk-bd-tab__soon">{t("base.runtimes.botDetail.soon")}</span>}
          </button>
        ))}
      </nav>

      {/* ── Body ──────────────────────────────────────────── */}
      <div className="wk-bd-body">
        {tab === 'info' && <InfoTab bot={bot} />}
        {tab === 'feed' && (TAB_READY.feed ? <FeedTab bot={bot} /> : <ComingSoon title={t("base.runtimes.botDetail.tabFeed")} />)}
        {tab === 'tasks' && (TAB_READY.tasks ? <TasksTab bot={bot} /> : <ComingSoon title={t("base.runtimes.botDetail.taskHistory")} />)}
        {tab === 'skills' && (TAB_READY.skills ? <SkillsTab /> : <ComingSoon title={t("base.runtimes.botDetail.tabSkills")} />)}
      </div>
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────

function InfoTab({ bot }: { bot: Bot }) {
  const { t } = useI18n();
  return (
    <div className="wk-bd-section">
      <h3 className="wk-bd-section__title">{t("base.runtimes.botDetail.sectionConfig")}</h3>
      <dl className="wk-bd-props">
        {/* PR-2: 删 #runtime_id (dev 级 PK, 用户用不到), 只留 kind. */}
        <PropRow label={t("base.runtimes.botDetail.propRuntime")} value={<span className="wk-bd-mono">{bot.runtime_kind}</span>} />
        <PropRow label={t("base.runtimes.botDetail.propOwner")} value={<OwnerLabel ownerUid={bot.owner_uid} />} />
        <PropRow label={t("base.runtimes.botDetail.propStatus")} value={<span className="wk-bd-mono">{bot.status}</span>} />
        {/* PR-2: 删 Workspace 字段 — dev 级实现细节, 用户不需要管. */}
      </dl>
      <h3 className="wk-bd-section__title wk-bd-section__title--secondary">{t("base.runtimes.botDetail.sectionIdentity")}</h3>
      <dl className="wk-bd-props">
        <PropRow label="Bot UID" value={<Copyable text={bot.bot_uid} mono />} />
        {/* PR-2: 删 Daemon ID 字段, 是 dev 级 UUID, 用户用不到. */}
        <PropRow label={t("base.runtimes.botDetail.propCreatedAt")} value={<span className="wk-bd-props__time">{bot.created_at}</span>} />
        <PropRow label={t("base.runtimes.botDetail.propUpdatedAt")} value={<span className="wk-bd-props__time">{bot.updated_at}</span>} />
      </dl>
      {bot.error_msg && (
        <div className="wk-bd-callout wk-bd-callout--err">
          <span className="wk-bd-callout__label">{t("base.runtimes.botDetail.lastError")}</span>
          <span className="wk-bd-callout__body">{bot.error_msg}</span>
        </div>
      )}
    </div>
  );
}

// PR-2: 所有者字段不再裸显示 UUID. bot.owner_uid 当前永远 = 登录用户
// (api_key 跟 user 1:1 绑定), 所以查 WKApp.loginInfo 拿用户名 + Octo 号
// (短号) 显示, 跟其他业务侧用户标识保持一致. 万一 owner ≠ 登录用户
// (未来转移所有权), fallback 回 UUID 缩写.
function OwnerLabel({ ownerUid }: { ownerUid: string }) {
  const { t } = useI18n();
  const login = (WKApp as any).loginInfo;
  const isMe = login?.uid === ownerUid;
  if (isMe) {
    const name = login?.name || t("base.runtimes.botDetail.me");
    const shortNo = login?.shortNo;
    return (
      <span className="wk-bd-owner">
        <span className="wk-bd-mono">{name}</span>
        {shortNo && <span className="wk-bd-props__hint">@{shortNo}</span>}
      </span>
    );
  }
  // 非当前登录用户 (例如 admin 视角 / 未来支持 transfer ownership) —
  // 直接显示 UUID 缩写, 防止泄露完整 ID 又能让人区分.
  return (
    <span className="wk-bd-mono" title={ownerUid}>
      {ownerUid ? `${ownerUid.slice(0, 8)}…${ownerUid.slice(-4)}` : '—'}
    </span>
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
  const { t } = useI18n();
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
          aria-label={t("base.runtimes.common.copy")}
        >{copied ? '✓' : '⧉'}</button>
      )}
    </span>
  );
}

function FeedTab({ bot }: { bot: Bot }) {
  const { t } = useI18n();
  const [items, setItems] = useState<BotFeedItem[] | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await getBotFeed(bot.bot_uid, 50);
      setItems(data);
    } catch {
      setItems([]);
    }
  }, [bot.bot_uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
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
        .map(task => task.detail?.elapsed_ms as number | undefined)
        .filter((n): n is number => typeof n === 'number' && n > 0);
      if (els.length === 0) return null;
      return Math.round(els.reduce((a, b) => a + b, 0) / els.length);
    })();
    return { total, completed, failed, successPct, avgMs };
  }, [items]);

  if (items === null) return <div className="wk-bd-empty">{t("base.runtimes.common.loading")}</div>;

  return (
    <>
      {/* Recent performance card */}
      {stats && stats.total > 0 && (
        <section className="wk-bd-section wk-bd-section--card">
          <h3 className="wk-bd-section__title">{t("base.runtimes.botDetail.sectionPerformance")}</h3>
          <div className="wk-bd-stats">
            <div className="wk-bd-stats__col">
              <div className="wk-bd-stats__big">{stats.total}</div>
              <div className="wk-bd-stats__sub">{t("base.runtimes.botDetail.statRuns")}</div>
            </div>
            {stats.successPct !== null && (
              <div className="wk-bd-stats__col">
                <div className="wk-bd-stats__big">{stats.successPct}%</div>
                <div className="wk-bd-stats__sub">{t("base.runtimes.botDetail.statSuccessRate")}</div>
              </div>
            )}
            {stats.avgMs !== null && (
              <div className="wk-bd-stats__col">
                <div className="wk-bd-stats__big">{(stats.avgMs / 1000).toFixed(1)}<span className="wk-bd-stats__unit">s</span></div>
                <div className="wk-bd-stats__sub">{t("base.runtimes.botDetail.statAvgDuration")}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Activity feed */}
      <section className="wk-bd-section wk-bd-section--card">
        <h3 className="wk-bd-section__title">{t("base.runtimes.botDetail.tabFeed")}</h3>
        {items.length === 0 ? (
          <div className="wk-bd-empty wk-bd-empty--inline">{t("base.runtimes.botDetail.noActivity")}</div>
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
  const { t } = useI18n();
  const [items, setItems] = useState<BotFeedItem[] | null>(null);
  useEffect(() => {
    getBotFeed(bot.bot_uid, 100)
      .then(data => setItems(data.filter(i => i.kind === 'activity' && i.action?.startsWith('agent_task'))))
      .catch(() => setItems([]));
  }, [bot.bot_uid]);
  if (items === null) return <div className="wk-bd-empty">{t("base.runtimes.common.loading")}</div>;
  if (items.length === 0) return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">{t("base.runtimes.botDetail.taskHistory")}</h3>
      <div className="wk-bd-empty wk-bd-empty--inline">{t("base.runtimes.botDetail.noTaskHistory")}</div>
    </section>
  );
  return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">{t("base.runtimes.botDetail.taskHistory")} <span className="wk-bd-section__count">{items.length}</span></h3>
      <ul className="wk-bd-tasks">
        {items.map(task => {
          const ok = task.action === 'agent_task_completed';
          const elapsed = (task.detail?.elapsed_ms as number | undefined);
          const bytes = (task.detail?.bytes as number | undefined);
          const err = (task.detail?.error as string | undefined);
          return (
            <li key={task.id} className={`wk-bd-task${ok ? '' : ' wk-bd-task--failed'}`}>
              <span className={`wk-bd-task__icon wk-bd-task__icon--${ok ? 'ok' : 'fail'}`} aria-hidden="true">
                {ok ? '✓' : '✗'}
              </span>
              <div className="wk-bd-task__main">
                <div className="wk-bd-task__title">{matterLabel(task)}</div>
                <div className="wk-bd-task__meta">
                  <span>{formatTime(task.created_at)}</span>
                  {elapsed != null && <><span>·</span><span>{(elapsed / 1000).toFixed(1)}s</span></>}
                  {bytes != null && bytes > 0 && <><span>·</span><span>{t("base.runtimes.botDetail.bytes", { values: { n: bytes } })}</span></>}
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
  const { t } = useI18n();
  return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">{t("base.runtimes.botDetail.tabSkills")}</h3>
      <div className="wk-bd-empty wk-bd-empty--inline">{t("base.runtimes.botDetail.skillsPlaceholder")}</div>
    </section>
  );
}

// 「待上线」占位 — 用于本期未开放的 tab (动态/任务记录依赖 matter; Skills 待开发).
function ComingSoon({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <section className="wk-bd-section wk-bd-section--card">
      <h3 className="wk-bd-section__title">{title}</h3>
      <div className="wk-bd-empty wk-bd-empty--inline">{t("base.runtimes.botDetail.featureInDev")}</div>
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
      return tt("base.runtimes.botDetail.actDispatch");
    case 'agent_task_completed': {
      const ms = (detail?.elapsed_ms as number | undefined);
      const bytes = (detail?.bytes as number | undefined);
      const tStr = ms != null ? `${(ms / 1000).toFixed(1)}s` : '';
      const b = bytes != null && bytes > 0 ? tt("base.runtimes.botDetail.bytes", { values: { n: bytes } }) : '';
      const suffix = `${tStr || b ? ' · ' : ''}${[tStr, b].filter(Boolean).join(' · ')}`;
      return tt("base.runtimes.botDetail.actComplete", { values: { suffix } });
    }
    case 'agent_task_failed':
      return tt("base.runtimes.botDetail.actFailed", { values: { error: String(detail?.error ?? '').slice(0, 60) } });
    default:
      return action;
  }
}

function matterLabel(it: BotFeedItem): string {
  if (it.matter_seq_no && it.matter_title) return `M-${it.matter_seq_no} ${it.matter_title}`;
  if (it.matter_seq_no) return `M-${it.matter_seq_no}`;
  return `matter ${it.matter_id.slice(0, 8)}`;
}
