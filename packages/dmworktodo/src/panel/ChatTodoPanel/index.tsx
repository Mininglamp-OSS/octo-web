import React, { useState } from 'react';
import type { Matter } from '../../bridge/types';
import { useMatterList } from '../../hooks/useTodoList';
import DetailPanel from '../../ui/DetailPanel';
import '../../pages/MatterPage.css';

export interface ChatMatterPanelProps {
  channelId: string;
  channelType: number;
  channelName?: string;
  onClose: () => void;
}

type Tab = 'mine' | 'created' | 'all';

/**
 * ChatMatterPanel — 频道侧边事项面板
 *
 * 复用 MatterPage sidebar 的 CSS class（wk-mp-page-sidebar / wk-mp-sidebar-card），
 * 保证两处事项列表 UI 完全一致。
 *
 * TODO(backend): "我负责的" 需要 assignee_id 过滤
 * TODO(backend): 当前用 source_channel_id 过滤，后续改为 channel 关联查询
 */
export default function ChatMatterPanel({
  channelId,
  channelType,
  channelName,
  onClose,
}: ChatMatterPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);

  const { matters, loading, reload } = useMatterList({
    initialFilters: {
      source_channel_id: channelId,
      source_channel_type: channelType,
    },
    pageSize: 100,
  });

  // TODO(backend): 按 tab 过滤
  const displayMatters = matters;

  const channel = { channelId, channelType, name: channelName };

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'mine', label: '我负责的' },
    { id: 'created', label: '我创建的' },
    { id: 'all', label: '全部' },
  ];

  return (
    <div className="wk-mp-page-sidebar">
      {/* Header */}
      {!selectedMatterId && (
        <div className="wk-mp-page-sidebar__header">
          <h2 className="wk-mp-page-sidebar__title">事项</h2>
          <button type="button" className="wk-mp-page-sidebar__close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
      )}

      {/* Tabs */}
      {!selectedMatterId && (
        <div className="wk-mp-page-sidebar__tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`wk-mp-page-sidebar__tab${activeTab === t.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="wk-mp-page-sidebar__list">
        {selectedMatterId ? (
          <DetailPanel
            matterId={selectedMatterId}
            channel={channel}
            onClose={() => setSelectedMatterId(null)}
            onStatusChanged={reload}
            showBack
          />
        ) : (
          <>
            {loading && <div className="wk-mp-page-sidebar__empty">加载中...</div>}
            {!loading && displayMatters.length === 0 && (
              <div className="wk-mp-page-sidebar__empty">暂无事项</div>
            )}
            {!loading && displayMatters.map((matter) => (
              <SidebarCard
                key={matter.id}
                matter={matter}
                selected={matter.id === selectedMatterId}
                onClick={() => setSelectedMatterId(matter.id)}
              />
            ))}
            {!loading && displayMatters.length > 0 && (
              <button type="button" className="wk-mp-page-sidebar__archived-toggle">
                <span className="wk-mp-page-sidebar__archived-chev">▸</span>
                已归档 (0)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── 复用 MatterPage 的 SidebarCard 样式 ─────────────────

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  open: { label: '进行中', className: 'wk-mp-sidebar-card__status--active' },
  done: { label: '已完成', className: 'wk-mp-sidebar-card__status--done' },
  archived: { label: '已归档', className: 'wk-mp-sidebar-card__status--archived' },
};

function formatDdl(deadline?: string): string {
  if (!deadline) return '';
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function SidebarCard({
  matter,
  selected,
  onClick,
}: {
  matter: Matter;
  selected: boolean;
  onClick: () => void;
}) {
  const status = STATUS_MAP[matter.status] || STATUS_MAP.open;
  const ddl = formatDdl(matter.deadline);

  return (
    <button
      type="button"
      className={`wk-mp-sidebar-card${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      <div className="wk-mp-sidebar-card__row1">
        <span className="wk-mp-sidebar-card__id">{matter.id.slice(0, 8)}</span>
        <span className={`wk-mp-sidebar-card__status ${status.className}`}>
          <span className="wk-mp-sidebar-card__status-dot" />
          {status.label}
        </span>
        {ddl && <span className="wk-mp-sidebar-card__ddl">DDL {ddl}</span>}
      </div>
      <div className="wk-mp-sidebar-card__title">{matter.title}</div>
      <div className="wk-mp-sidebar-card__meta">
        {/* TODO: 用 UserName 组件解析 creator_id → 显示名 */}
        <span className="wk-mp-sidebar-card__creator">{matter.creator_id.slice(0, 6)}</span>
        <span className="wk-mp-sidebar-card__meta-label">创建</span>
        {matter.source_name && (
          <>
            <span className="wk-mp-sidebar-card__sep">·</span>
            <span className="wk-mp-sidebar-card__channel">#{matter.source_name}</span>
          </>
        )}
      </div>
      {/* TODO: owners 行需要后端返回 assignee 名字列表 */}
      <div className="wk-mp-sidebar-card__owners">
        <span className="wk-mp-sidebar-card__owners-label">负责</span>
      </div>
    </button>
  );
}

export { ChatMatterPanel };
