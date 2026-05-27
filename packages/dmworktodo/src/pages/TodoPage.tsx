import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { WKApp, useI18n } from "@octo/base";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import type { MatterListParams } from "../bridge/types";
import { createMatter } from "../api/todoApi";
import { useMatterList } from "../hooks/useTodoList";
import MatterDetailPanel from "../panel/MatterDetailPanel";
import SmartCreateModal from "../ui/SmartCreateModal";
import SidebarCard from "../ui/SidebarCard";
import UserName from "../ui/UserName";
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
 */

type NavTab = "mine" | "created" | "all";

function buildParams(tab: NavTab, myUid: string): MatterListParams {
  if (tab === "mine") return { assignee_id: myUid };
  if (tab === "created") return { creator_id: myUid };
  return {};
}

export default function MatterPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<NavTab>("mine");
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<NavTab, number>>({
    mine: 0,
    created: 0,
    all: 0,
  });

  const myUid = WKApp.loginInfo.uid ?? "";
  const tabs = useMemo<Array<{ id: NavTab; label: string }>>(() => [
    { id: "mine", label: t("todo.tabs.mine") },
    { id: "created", label: t("todo.tabs.created") },
    { id: "all", label: t("todo.tabs.all") },
  ], [t]);

  // ── UI/数据分离: 为 ui/ 组件提供 renderAvatar / renderUserName ──
  const renderAvatar = useCallback(
    (uid: string, size: number) => (
      <WKAvatar
        channel={new Channel(uid, ChannelTypePerson)}
        style={{ width: size, height: size }}
      />
    ),
    [],
  );
  const renderUserName = useCallback(
    (uid: string) => <UserName uid={uid} />,
    [],
  );

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

  // 详情面板编辑 matter (标题 / 主要目标 / DDL / 状态 / 负责人 / 关联群聊)
  // 后会广播 wk:matter-updated, 这里 reload 保证左侧列表拿到最新字段。
  // 详情面板删除 matter 后广播 wk:matter-deleted, 同样 reload 移除该条。
  //
  // 滚动位置锁定: reload 会整替 matters 数组 → 列表 DOM 重建 → scrollTop
  // 被重置到 0, 用户看到的 "当前编辑的卡片" 跳走。解法是: 事件触发 reload
  // 前抓一下当前 scrollTop 存到 ref, 新 matters 渲染完 useLayoutEffect 写回。
  // 只在编辑 / 删除场景恢复, 用户主动切 tab / 空间切换时还是回顶 (期望)。
  const listRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  useEffect(() => {
    const reloader = () => {
      if (listRef.current) {
        pendingScrollRestoreRef.current = listRef.current.scrollTop;
      }
      reload();
    };
    WKApp.mittBus.on("wk:matter-updated", reloader);
    WKApp.mittBus.on("wk:matter-deleted", reloader);
    return () => {
      WKApp.mittBus.off("wk:matter-updated", reloader);
      WKApp.mittBus.off("wk:matter-deleted", reloader);
    };
  }, [reload]);
  // matters 数组引用变化后 (新数据到达) 同步恢复 scrollTop。用 layoutEffect
  // 而不是 effect, 是因为浏览器在 effect 之前就已经把 scrollTop 清零并 paint,
  // useLayoutEffect 在 DOM mutation 后、浏览器 paint 前触发, 恢复无闪烁。
  useLayoutEffect(() => {
    const saved = pendingScrollRestoreRef.current;
    if (saved !== null && listRef.current) {
      listRef.current.scrollTop = saved;
      pendingScrollRestoreRef.current = null;
    }
  }, [matters]);

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
        <h2 className="wk-mp-page-sidebar__title">{t("todo.menu.title")}</h2>
        <button
          type="button"
          className="wk-mp-page-sidebar__new-btn"
          onClick={() => setShowCreateModal(true)}
          title={t("todo.action.new")}
          aria-label={t("todo.action.new")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2.67v10.66M2.67 8h10.66" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="wk-mp-page-sidebar__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`wk-mp-page-sidebar__tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tabCounts[tab.id] > 0 && (
              <span className="wk-mp-page-sidebar__tab-count">
                {tabCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="wk-mp-page-sidebar__list" ref={listRef}>
        {loading && <div className="wk-mp-page-sidebar__empty">{t("todo.state.loading")}</div>}
        {!loading && activeMatters.length === 0 && (
          <div className="wk-mp-page-sidebar__empty">{t("todo.state.empty")}</div>
        )}
        {!loading && activeMatters.length > 0 && (
          <div className="wk-mp-page-sidebar__archived-toggle" style={{ cursor: 'default' }}>
            <span className="wk-mp-page-sidebar__archived-bar" />
            <span className="wk-mp-page-sidebar__nav-label">{t("todo.status.unarchived")}</span>
          </div>
        )}
        {!loading &&
          activeMatters.map((matter) => (
            <SidebarCard
              key={matter.id}
              matter={matter}
              selected={matter.id === selectedMatterId}
              onClick={() => handleSelect(matter.id)}
              renderAvatar={renderAvatar}
              renderUserName={renderUserName}
              sourceChannelName={matter.source_name}
            />
          ))}

        {/* 已归档折叠区 */}
        {!loading && (
          <button
            type="button"
            className="wk-mp-page-sidebar__archived-toggle"
            onClick={() => setArchivedExpanded(!archivedExpanded)}
          >
            <span className="wk-mp-page-sidebar__archived-bar" />
            <span className="wk-mp-page-sidebar__nav-label">{t("todo.status.archivedCount", { values: { count: archivedMatters.length } })}</span>
            <span
              className={`wk-mp-page-sidebar__archived-chev${archivedExpanded ? " is-open" : ""}`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6.29 4.27L9.71 8l-3.42 3.73" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        )}
        {archivedExpanded &&
          archivedMatters.map((matter) => (
            <SidebarCard
              key={matter.id}
              matter={matter}
              selected={matter.id === selectedMatterId}
              onClick={() => handleSelect(matter.id)}
              renderAvatar={renderAvatar}
              renderUserName={renderUserName}
              sourceChannelName={matter.source_name}
            />
          ))}

        {!loading && hasMore && (
          <button
            type="button"
            className="wk-mp-page-sidebar__loadmore"
            onClick={loadMore}
          >
            {t("todo.action.loadMore")}
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
          Toast.success(t("todo.toast.created"));
        }}
      />
    </div>
  );
}
