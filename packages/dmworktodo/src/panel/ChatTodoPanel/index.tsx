import React, { useState, useRef, useEffect, useCallback } from "react";
import { useMatterList } from "../../hooks/useTodoList";
import MatterDetailPanel from "../MatterDetailPanel";
import SidebarCard from "../../ui/SidebarCard";
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
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);

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

  const displayMatters = matters;

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "mine", label: "我负责的" },
    { id: "created", label: "我创建的" },
    { id: "all", label: "全部" },
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
      <div ref={panelRef}>
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
        <h2 className="wk-mp-page-sidebar__title">事项</h2>
        <button
          type="button"
          className="wk-mp-page-sidebar__close"
          onClick={onClose}
          aria-label="关闭"
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

      <div className="wk-mp-page-sidebar__list">
        {loading && <div className="wk-mp-page-sidebar__empty">加载中...</div>}
        {!loading && displayMatters.length === 0 && (
          <div className="wk-mp-page-sidebar__empty">暂无事项</div>
        )}
        {!loading &&
          displayMatters.map((matter) => (
            <SidebarCard
              key={matter.id}
              matter={matter}
              selected={false}
              onClick={() => setSelectedMatterId(matter.id)}
            />
          ))}
        {!loading && displayMatters.length > 0 && (
          <button type="button" className="wk-mp-page-sidebar__archived-toggle">
            <span className="wk-mp-page-sidebar__archived-chev">▸</span>
            已归档 (0)
          </button>
        )}
      </div>

      {isDragging && <div className="wk-thread-panel-drag-overlay" />}
    </div>
  );
}

export { ChatMatterPanel };
