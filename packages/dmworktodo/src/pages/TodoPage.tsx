import React, { useState, useEffect, useMemo } from 'react';
import { WKApp } from '@octo/base';
import type { Matter, MatterListParams } from '../bridge/types';
import { useMatterList } from '../hooks/useTodoList';
import MatterDetailPanel from '../panel/MatterDetailPanel';
import SmartCreateModal from '../ui/SmartCreateModal';
import './MatterPage.css';

/**
 * MatterPage — 事项全屏页面（NavRail "事项" 入口）
 *
 * 渲染在 WKLayout 的 contentLeft（窄 sidebar 区域，宽度可拖拽）。
 * 点击卡片 → 通过 routeRight 推详情到右侧面板。
 *
 * 对齐 PRD v0.7 §10 + 原型 SidebarV5（经审查调整）：
 *   - Tab：我负责的 / 我发起的 / 全部
 *   - 不放"新建"按钮（PRD §3 创建从 IM 多选触发）
 *   - 卡片：M-ID + 状态 + DDL + 标题 + creator + channel
 *   - 底部：已归档折叠区
 *
 * TODO(backend): 详情暂用 mock，后续接真实 API
 */

type NavTab = 'mine' | 'created' | 'all';

const TABS: Array<{ id: NavTab; label: string }> = [
  { id: 'mine', label: '我负责的' },
  { id: 'created', label: '我发起的' },
  { id: 'all', label: '全部' },
];

function buildParams(tab: NavTab, myUid: string): MatterListParams {
  if (tab === 'mine') return { assignee_id: myUid };
  if (tab === 'created') return { creator_id: myUid };
  return {};
}

function formatDdl(deadline?: string): string {
  if (!deadline) return '';
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  open: { label: '进行中', className: 'wk-mp-sidebar-card__status--active' },
  done: { label: '已完成', className: 'wk-mp-sidebar-card__status--done' },
  archived: { label: '已归档', className: 'wk-mp-sidebar-card__status--archived' },
};

export default function MatterPage() {
  const [activeTab, setActiveTab] = useState<NavTab>('mine');
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const myUid = WKApp.loginInfo.uid ?? '';
  const initialFilters = useMemo(() => buildParams(activeTab, myUid), [activeTab, myUid]);

  const { matters, loading, hasMore, loadMore } = useMatterList({ initialFilters });

  // 分离活跃 vs 归档
  const activeMatters = useMemo(() => matters.filter((m) => m.status !== 'archived'), [matters]);
  const archivedMatters = useMemo(() => matters.filter((m) => m.status === 'archived'), [matters]);

  // 点击卡片 → 推详情到右侧面板
  const handleSelect = (matterId: string) => {
    setSelectedMatterId(matterId);
    WKApp.routeRight.replaceToRoot(
      <MatterDetailPanel
        key={matterId}
        channelId=""
        channelType={0}
        onClose={() => setSelectedMatterId(null)}
      />
    );
  };

  // Tab 切换时重置选中
  useEffect(() => {
    setSelectedMatterId(null);
  }, [activeTab]);

  // Space 切换重置
  useEffect(() => {
    const handler = () => {
      setActiveTab('mine');
      setSelectedMatterId(null);
    };
    WKApp.mittBus.on('space-changed', handler);
    return () => { WKApp.mittBus.off('space-changed', handler); };
  }, []);

  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="wk-mp-page-sidebar">
      {/* Header */}
      <div className="wk-mp-page-sidebar__header">
        <h2 className="wk-mp-page-sidebar__title">事项</h2>
        {/* TODO(interaction): 点击打开 SmartCreateModal（blank 模式，PRD §3） */}
        <button type="button" className="wk-mp-page-sidebar__new-btn" onClick={() => setShowCreateModal(true)} title="新建事项">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建
        </button>
      </div>

      {/* Tabs */}
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

      {/* 列表 */}
      <div className="wk-mp-page-sidebar__list">
        {loading && <div className="wk-mp-page-sidebar__empty">加载中...</div>}
        {!loading && activeMatters.length === 0 && (
          <div className="wk-mp-page-sidebar__empty">暂无事项</div>
        )}
        {!loading && activeMatters.map((matter) => (
          <SidebarCard
            key={matter.id}
            matter={matter}
            selected={matter.id === selectedMatterId}
            onClick={() => handleSelect(matter.id)}
          />
        ))}

        {/* 已归档折叠区 */}
        {!loading && (
          <button
            type="button"
            className="wk-mp-page-sidebar__archived-toggle"
            onClick={() => setArchivedExpanded(!archivedExpanded)}
          >
            <span className={`wk-mp-page-sidebar__archived-chev${archivedExpanded ? ' is-open' : ''}`}>▸</span>
            已归档 ({archivedMatters.length})
          </button>
        )}
        {archivedExpanded && archivedMatters.map((matter) => (
          <SidebarCard
            key={matter.id}
            matter={matter}
            selected={matter.id === selectedMatterId}
            onClick={() => handleSelect(matter.id)}
          />
        ))}

        {!loading && hasMore && (
          <button type="button" className="wk-mp-page-sidebar__loadmore" onClick={loadMore}>
            加载更多
          </button>
        )}
      </div>

      {/* SmartCreateModal */}
      {showCreateModal && (
        <SmartCreateModal
          blank
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => {
            // TODO(backend): 调用 createMatter API
            console.log('[Matter] create:', data);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Sidebar Card ─────────────────────────────────────────

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
      {/* TODO: owners 行需要后端返回 assignee 名字列表，当前用 creator_id 占位 */}
      <div className="wk-mp-sidebar-card__owners">
        <span className="wk-mp-sidebar-card__owners-label">负责</span>
      </div>
    </button>
  );
}
