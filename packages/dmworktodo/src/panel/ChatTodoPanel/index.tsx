import React, { useState, useCallback } from 'react';
import type { Matter } from '../../bridge/types';
import { useMatterList } from '../../hooks/useTodoList';
import DetailPanel from '../../ui/DetailPanel';
import QuickAddBar from '../../ui/QuickAddBar';
import './index.css';

export interface ChatMatterPanelProps {
  channelId: string;
  channelType: number;
  channelName?: string;
  onClose: () => void;
}

type Tab = 'created' | 'all';

/**
 * ChatMatterPanel — 频道侧边事项面板
 *
 * 视觉对齐原型 SidebarV5 的卡片风格：
 *   - M-ID + StatusBadge + DDL
 *   - 标题
 *   - creator + channel
 *
 * Tab：我创建的 / 全部
 *
 * TODO(backend): "我关注的" tab 需要后端支持 favorited 查询
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

  const { matters, loading, reload, addOptimistic, removeOptimistic } = useMatterList({
    initialFilters: {
      source_channel_id: channelId,
      source_channel_type: channelType,
    },
    pageSize: 100,
  });

  // TODO(backend): creator_id 过滤需要知道当前用户 UID
  const displayMatters = activeTab === 'all' ? matters : matters;

  const handleQuickCreated = useCallback((matter: Matter) => {
    if (matter.id.startsWith('__rollback__')) {
      removeOptimistic(matter.id.replace('__rollback__', '__optimistic__'));
      reload();
      return;
    }
    if (matter.id.startsWith('__optimistic__')) {
      addOptimistic(matter);
      return;
    }
    removeOptimistic('__optimistic__');
    reload();
  }, [reload, addOptimistic, removeOptimistic]);

  const channel = { channelId, channelType, name: channelName };

  return (
    <div className="wk-matter-chat-panel">
      {/* Header */}
      {!selectedMatterId && (
        <div className="wk-matter-chat-panel__header">
          <span className="wk-matter-chat-panel__title">事项</span>
          <button type="button" className="wk-matter-chat-panel__close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
      )}

      {/* Tabs */}
      {!selectedMatterId && (
        <div className="wk-matter-chat-panel__tabs">
          <button
            type="button"
            className={`wk-matter-chat-panel__tab${activeTab === 'created' ? ' wk-matter-chat-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('created')}
          >
            我创建的
          </button>
          {/* TODO(backend): 我关注的 tab */}
          <button
            type="button"
            className={`wk-matter-chat-panel__tab${activeTab === 'all' ? ' wk-matter-chat-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            全部 <span className="wk-matter-chat-panel__tab-count">{matters.length}</span>
          </button>
        </div>
      )}

      {/* Body */}
      <div className="wk-matter-chat-panel__body">
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
            {loading && <div className="wk-matter-chat-panel__empty">加载中...</div>}
            {!loading && displayMatters.length === 0 && (
              <div className="wk-matter-chat-panel__empty">暂无事项</div>
            )}
            {!loading && displayMatters.map((matter) => (
              <MatterListCard
                key={matter.id}
                matter={matter}
                selected={matter.id === selectedMatterId}
                onClick={() => setSelectedMatterId(matter.id)}
              />
            ))}
            {!loading && displayMatters.length > 0 && (
              <div className="wk-matter-chat-panel__archived">已归档 (0) · 折叠展开</div>
            )}
          </>
        )}
      </div>

      {/* Quick add footer */}
      {!selectedMatterId && (
        <QuickAddBar
          channelId={channelId}
          channelType={channelType}
          channelName={channelName}
          onCreated={handleQuickCreated}
        />
      )}
    </div>
  );
}

// ─── V5 风格卡片 ─────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  open: { label: '进行中', className: 'wk-matter-list-card__status--active' },
  done: { label: '已完成', className: 'wk-matter-list-card__status--done' },
  archived: { label: '已归档', className: 'wk-matter-list-card__status--archived' },
};

function formatDdl(deadline?: string): string {
  if (!deadline) return '';
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function MatterListCard({
  matter,
  selected,
  onClick,
}: {
  matter: Matter;
  selected?: boolean;
  onClick: () => void;
}) {
  const status = STATUS_MAP[matter.status] || STATUS_MAP.open;
  const ddl = formatDdl(matter.deadline);

  return (
    <button
      type="button"
      className={`wk-matter-list-card${selected ? ' wk-matter-list-card--selected' : ''}`}
      onClick={onClick}
    >
      <div className="wk-matter-list-card__row1">
        <span className="wk-matter-list-card__id">{matter.id.slice(0, 8)}</span>
        <span className={`wk-matter-list-card__status ${status.className}`}>
          <span className="wk-matter-list-card__status-dot" />
          {status.label}
        </span>
        {ddl && <span className="wk-matter-list-card__ddl">DDL {ddl}</span>}
      </div>
      <div className="wk-matter-list-card__title">{matter.title}</div>
      <div className="wk-matter-list-card__meta">
        {/* TODO: 用 UserName 组件解析 creator_id → 显示名 */}
        <span className="wk-matter-list-card__creator">{matter.creator_id.slice(0, 6)}</span>
        {matter.source_name && (
          <>
            <span className="wk-matter-list-card__sep">·</span>
            <span className="wk-matter-list-card__channel">#{matter.source_name}</span>
          </>
        )}
      </div>
    </button>
  );
}

export { ChatMatterPanel };
