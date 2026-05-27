import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { WKApp, useI18n } from "@octo/base";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import { useMatterList } from "../../hooks/useTodoList";
import MatterDetailPanel from "../MatterDetailPanel";
import SidebarCard from "../../ui/SidebarCard";
import UserName from "../../ui/UserName";
import {
  THREAD_DEFAULT_WIDTH,
  clampThreadWidth,
  restoreThreadWidth,
  persistThreadWidth,
} from "@octo/base/src/Components/WKLayout/layoutWidth";
import "../../pages/MatterPage.css";

export interface ChatMatterPanelProps {
  channelId: string;
  channelType: number;
  channelName?: string;
  onClose: () => void;
}

type Tab = "mine" | "created" | "all";

export default function ChatMatterPanel({
  channelId,
  channelType,
  channelName,
  onClose,
}: ChatMatterPanelProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);

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

  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const lastPanelWidth = useRef(
    clampThreadWidth(restoreThreadWidth(), window.innerWidth, 300),
  );

  const { matters, loading, reload } = useMatterList({
    initialFilters: {
      // 用 channel_id (todos PR #38) 严格按 channel 过滤:
      //   - 只返回 matter_channels 关联了本 channel 的 Matter
      //   - 跟 source_channel_id 的区别是 AND 而非 OR, 不会混入
      //     "我相关但跟本群无关" 的 Matter
      //   - 后端不需要 channel_type 配对参数 (matter_channels 唯一键是
      //     (matter_id, channel_id), channel_type 冗余)
      channel_id: channelId,
    },
    pageSize: 100,
  });

  // 详情面板编辑 / 删除 matter 后广播 mitt 事件, 这里 reload 保持列表新鲜。
  // 跟 TodoPage 用同一套事件; 会话右侧面板跟详情面板在同一个 React 子树里
  // 按理说 setMatter 后可以直接刷新, 但详情面板实际是 key 重建出来的,
  // 事件驱动更简单, 不用做 props 回传。
  //
  // 滚动位置锁定: reload 整替 matters → 列表 DOM 重建 → scrollTop 归 0,
  // 用户看到的卡片跳走。reload 前存一下 scrollTop, 新数据渲染完用
  // useLayoutEffect 在 paint 前写回, 无闪烁。
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
  useLayoutEffect(() => {
    const saved = pendingScrollRestoreRef.current;
    if (saved !== null && listRef.current) {
      listRef.current.scrollTop = saved;
      pendingScrollRestoreRef.current = null;
    }
  }, [matters]);

  const currentUid = WKApp.loginInfo.uid;
  const displayMatters = (() => {
    switch (activeTab) {
      case "mine":
        return matters.filter(
          (m) => m.assignees?.some((a) => a.user_id === currentUid),
        );
      case "created":
        return matters.filter((m) => m.creator_id === currentUid);
      case "all":
      default:
        return matters;
    }
  })();

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "mine", label: t("todo.tabs.mine") },
    { id: "created", label: t("todo.tabs.created") },
    { id: "all", label: t("todo.tabs.all") },
  ];

  // ── Splitter drag ──
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = lastPanelWidth.current;
    setIsDragging(true);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onDragMove = useCallback((e: MouseEvent) => {
    const delta = dragStartX.current - e.clientX;
    const newWidth = clampThreadWidth(
      dragStartWidth.current + delta,
      window.innerWidth,
      300,
    );
    lastPanelWidth.current = newWidth;
    const panel = panelRef.current;
    if (panel) {
      panel.style.width = newWidth + "px";
      // CSS 变量要设在祖先 (.wk-chat-content-right) 上, 兄弟元素
      // (.wk-chat-content-chat) 才能 var() 拿到, 触发宽度挤压
      const ancestor = panel.closest(".wk-chat-content-right") as HTMLElement | null;
      if (ancestor) {
        ancestor.style.setProperty("--wk-width-thread-panel", newWidth + "px");
      }
      // 同时保留在父元素上, 保证 panel 自身宽度的其它消费者 (splitter 等) 可用
      panel.parentElement?.style.setProperty(
        "--wk-width-thread-panel",
        newWidth + "px",
      );
    }
  }, []);

  const onDragEnd = useCallback(() => {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setIsDragging(false);
    persistThreadWidth(lastPanelWidth.current);
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel) {
      panel.style.width = lastPanelWidth.current + "px";
      // 挤压会话区宽度依赖祖先 .wk-chat-content-right 上的 CSS 变量
      const ancestor = panel.closest(".wk-chat-content-right") as HTMLElement | null;
      if (ancestor) {
        ancestor.style.setProperty(
          "--wk-width-thread-panel",
          lastPanelWidth.current + "px",
        );
      }
      panel.parentElement?.style.setProperty(
        "--wk-width-thread-panel",
        lastPanelWidth.current + "px",
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  if (selectedMatterId) {
    return (
      <div className="wk-mp-page-sidebar" ref={panelRef}>
        <div
          className={`wk-thread-panel-splitter${isDragging ? " wk-thread-panel-splitter-active" : ""}`}
          onMouseDown={onDragStart}
        >
          <div className="wk-thread-panel-splitter-line" />
        </div>
        <MatterDetailPanel
          key={selectedMatterId}
          matterId={selectedMatterId}
          channelId={channelId}
          channelType={channelType}
          onClose={() => setSelectedMatterId(null)}
          showClose
        />
        {isDragging && <div className="wk-thread-panel-drag-overlay" />}
      </div>
    );
  }

  return (
    <div className="wk-mp-page-sidebar" ref={panelRef}>
      {/* Splitter */}
      <div
        className={`wk-thread-panel-splitter${isDragging ? " wk-thread-panel-splitter-active" : ""}`}
        onMouseDown={onDragStart}
      >
        <div className="wk-thread-panel-splitter-line" />
      </div>

      <div className="wk-mp-page-sidebar__header">
        <h2 className="wk-mp-page-sidebar__title">{t("todo.menu.title")}</h2>
        <button
          type="button"
          className="wk-mp-page-sidebar__close"
          onClick={onClose}
          aria-label={t("todo.common.close")}
        >
          ✕
        </button>
      </div>

      <div className="wk-mp-page-sidebar__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`wk-mp-page-sidebar__tab${activeTab === t.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wk-mp-page-sidebar__list" ref={listRef}>
        {loading && matters.length === 0 && <div className="wk-mp-page-sidebar__empty">{t("todo.state.loading")}</div>}
        {!loading && displayMatters.length === 0 && (
          <div className="wk-mp-page-sidebar__empty">{t("todo.state.empty")}</div>
        )}
        {displayMatters.map((matter) => (
            <SidebarCard
              key={matter.id}
              matter={matter}
              selected={false}
              onClick={() => setSelectedMatterId(matter.id)}
              renderAvatar={renderAvatar}
              renderUserName={renderUserName}
              sourceChannelName={matter.source_name}
            />
          ))}
        {displayMatters.length > 0 && (
          <button type="button" className="wk-mp-page-sidebar__archived-toggle">
            <span className="wk-mp-page-sidebar__archived-bar" />
            <span className="wk-mp-page-sidebar__nav-label">{t("todo.status.unarchived")}</span>
            <span className="wk-mp-page-sidebar__archived-chev">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6.29 4.27L9.71 8l-3.42 3.73" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {isDragging && <div className="wk-thread-panel-drag-overlay" />}
    </div>
  );
}

export { ChatMatterPanel };
