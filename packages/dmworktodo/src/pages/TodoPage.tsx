import React, { useState, useEffect, useMemo } from "react";
import { WKApp } from "@octo/base";
import { Toast } from "@douyinfe/semi-ui";
import type { MatterListParams } from "../bridge/types";
import { createMatter } from "../api/todoApi";
import { useMatterList } from "../hooks/useTodoList";
import MatterDetailPanel from "../panel/MatterDetailPanel";
import SmartCreateModal from "../ui/SmartCreateModal";
import SidebarCard from "../ui/SidebarCard";
import "./MatterPage.css";

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

type NavTab = "mine" | "created" | "all";

const TABS: Array<{ id: NavTab; label: string }> = [
  { id: "mine", label: "我负责的" },
  { id: "created", label: "我创建的" },
  { id: "all", label: "全部" },
];

function buildParams(tab: NavTab, myUid: string): MatterListParams {
  if (tab === "mine") return { assignee_id: myUid };
  if (tab === "created") return { creator_id: myUid };
  return {};
}

export default function MatterPage() {
  const [activeTab, setActiveTab] = useState<NavTab>("mine");
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<NavTab, number>>({
    mine: 0,
    created: 0,
    all: 0,
  });

  const myUid = WKApp.loginInfo.uid ?? "";
  const initialFilters = useMemo(
    () => buildParams(activeTab, myUid),
    [activeTab, myUid],
  );

  const { matters, loading, hasMore, loadMore, reload } = useMatterList({
    initialFilters,
  });

  useEffect(() => {
    setTabCounts((prev) => ({ ...prev, [activeTab]: matters.length }));
  }, [matters.length, activeTab]);

  // 点击 NavRail "事项" 按钮 → 强制刷新列表。
  // 理由: MainContentLeft 把所有访问过的路由都挂着 (display 切换), 事项页切走
  // 再切回时组件不会 remount, 数据会变陈旧。
  useEffect(() => {
    const handler = (data: { menuId: string }) => {
      if (data?.menuId === "matter") reload();
    };
    WKApp.mittBus.on("wk:nav-menu-activated", handler);
    return () => {
      WKApp.mittBus.off("wk:nav-menu-activated", handler);
    };
  }, [reload]);

  // 分离活跃 vs 归档
  const activeMatters = useMemo(
    () => matters.filter((m) => m.status !== "archived"),
    [matters],
  );
  const archivedMatters = useMemo(
    () => matters.filter((m) => m.status === "archived"),
    [matters],
  );

  // 点击卡片 → 推详情到右侧面板
  const handleSelect = (matterId: string) => {
    setSelectedMatterId(matterId);
    WKApp.routeRight.replaceToRoot(
      <MatterDetailPanel
        key={matterId}
        matterId={matterId}
        channelId=""
        channelType={0}
        onClose={() => setSelectedMatterId(null)}
      />,
    );
  };

  // Tab 切换时重置选中
  useEffect(() => {
    setSelectedMatterId(null);
  }, [activeTab]);

  // Space 切换重置
  useEffect(() => {
    const handler = () => {
      setActiveTab("mine");
      setSelectedMatterId(null);
    };
    WKApp.mittBus.on("space-changed", handler);
    return () => {
      WKApp.mittBus.off("space-changed", handler);
    };
  }, []);

  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="wk-mp-page-sidebar">
      {/* Header */}
      <div className="wk-mp-page-sidebar__header">
        <h2 className="wk-mp-page-sidebar__title">事项</h2>
        {/* TODO(interaction): 点击打开 SmartCreateModal（blank 模式，PRD §3） */}
        <button
          type="button"
          className="wk-mp-page-sidebar__new-btn"
          onClick={() => setShowCreateModal(true)}
          title="新建事项"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
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
            className={`wk-mp-page-sidebar__tab${activeTab === t.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {tabCounts[t.id] > 0 && (
              <span className="wk-mp-page-sidebar__tab-count">
                {tabCounts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="wk-mp-page-sidebar__list">
        {loading && <div className="wk-mp-page-sidebar__empty">加载中...</div>}
        {!loading && activeMatters.length === 0 && (
          <div className="wk-mp-page-sidebar__empty">暂无事项</div>
        )}
        {!loading &&
          activeMatters.map((matter) => (
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
            <span
              className={`wk-mp-page-sidebar__archived-chev${archivedExpanded ? " is-open" : ""}`}
            >
              ▸
            </span>
            已归档 ({archivedMatters.length})
          </button>
        )}
        {archivedExpanded &&
          archivedMatters.map((matter) => (
            <SidebarCard
              key={matter.id}
              matter={matter}
              selected={matter.id === selectedMatterId}
              onClick={() => handleSelect(matter.id)}
            />
          ))}

        {!loading && hasMore && (
          <button
            type="button"
            className="wk-mp-page-sidebar__loadmore"
            onClick={loadMore}
          >
            加载更多
          </button>
        )}
      </div>

      {/* SmartCreateModal */}
      <SmartCreateModal
        visible={showCreateModal}
        blank
        onClose={() => setShowCreateModal(false)}
        onConfirm={async (req) => {
          await createMatter(req);
          Toast.success("事项已创建");
        }}
      />
    </div>
  );
}
