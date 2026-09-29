import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@octo/base";
import ScheduleListPage from "../pages/ScheduleListPage";
import SummaryConfirmPage from "../pages/SummaryConfirmPage";
import SummaryWorkbenchCreateEntry from "../features/summaryWorkbench/SummaryWorkbenchCreateEntry";
import SummaryDetailPage from "../pages/SummaryDetailPage";
import SummaryListPage from "../pages/SummaryListPage";
import SummaryShareRoute from "./SummaryShareRoute";
import {
  getSummaryAttentionBadge,
  subscribeSummaryAttentionBadge,
} from "../utils/summaryAttentionBadge";
import type { SummaryReferenceTask } from "../types/summary";
import {
  legacySummaryMessagingPort,
  SummaryMessagingProvider,
} from "../host";
import type { SummaryWorkspaceProps, SummaryWorkspaceRoute } from "./types";
import "./index.css";

export default function SummaryWorkspace({
  route,
  onRouteChange,
  onOpenConversation,
  onBadgeChange,
  messaging,
}: SummaryWorkspaceProps) {
  const { t } = useI18n();
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [backgroundRefreshKey, setBackgroundRefreshKey] = useState(0);
  // 每次「+ / 新建会话」+1：拼进 create 视图的 React key，保证即使路由形状
  // 不变（例如已在 create 视图再点「+」）也会强制重挂 workbench，让
  // forceNewSession 真正生效（新空会话 + 旧会话进「上次对话」槽位）。
  const [createSeq, setCreateSeq] = useState(0);
  const messagingPort = useMemo(() => {
    const base = messaging ?? legacySummaryMessagingPort;
    if (!onOpenConversation) return base;
    return {
      getCurrentUser: () => base.getCurrentUser(),
      loadConversationMembers: (target) =>
        base.loadConversationMembers(target),
      openConversation: onOpenConversation,
      notifySummaryCompleted: (input) =>
        base.notifySummaryCompleted(input),
      requestForward: (input) => base.requestForward(input),
      subscribeInvalidation: (listener) =>
        base.subscribeInvalidation(listener),
    };
  }, [messaging, onOpenConversation]);

  useEffect(() => {
    if (!onBadgeChange) return undefined;
    try {
      onBadgeChange(getSummaryAttentionBadge());
    } catch (error) {
      console.warn("[SummaryWorkspace] Failed to report initial badge:", error);
    }
    return subscribeSummaryAttentionBadge(onBadgeChange);
  }, [onBadgeChange]);

  const refreshList = useCallback(
    () => setListRefreshKey((value) => value + 1),
    []
  );
  const refreshRetainedList = useCallback(
    () => setBackgroundRefreshKey((value) => value + 1),
    []
  );

  useEffect(
    () => messagingPort.subscribeInvalidation(refreshRetainedList),
    [messagingPort, refreshRetainedList]
  );

  const showList = () => onRouteChange({ view: "list" });
  const showCreate = (mode: "normal" | "agent" | "unified" = "normal") => {
    // 已在 create 视图时路由形状不变，onRouteChange 不会造成任何 props 差异；
    // createSeq 递增让 key 变化 → workbench 强制重挂 → 新会话语义生效。
    setCreateSeq((value) => value + 1);
    onRouteChange({ view: "create", mode: mode === "unified" ? "normal" : mode, source: "summary_list", fresh: true });
  };
  const showDetail = (taskId: number) =>
    onRouteChange({ view: "detail", taskId });
  const refreshListAndShow = () => {
    refreshList();
    showList();
  };
  const continueRefine = (task: SummaryReferenceTask) =>
    onRouteChange({
      view: "create",
      mode: "agent",
      source: "detail_optimize",
      derivedFromTask: task,
    });

  const renderContent = (currentRoute: SummaryWorkspaceRoute) => {
    switch (currentRoute.view) {
      case "create":
        return (
          <SummaryWorkbenchCreateEntry
            key={`${currentRoute.mode ?? "normal"}:${
              currentRoute.source ?? "summary_home"
            }:${currentRoute.derivedFromTask?.task_id ?? "new"}:${createSeq}`}
            legacyInitialMode={currentRoute.mode}
            source={currentRoute.source ?? "summary_home"}
            derivedFromTask={currentRoute.derivedFromTask}
            forceNewSession={currentRoute.fresh}
            onOpenTask={showDetail}
            onCreated={refreshList}
            messaging={messagingPort}
            onSubmit={(taskId) => {
              refreshList();
              showDetail(taskId);
            }}
          />
        );
      case "detail":
        return (
          <SummaryDetailPage
            key={currentRoute.taskId}
            taskId={currentRoute.taskId}
            originChannel={currentRoute.originConversation}
            emitSelection
            onAfterMutate={refreshListAndShow}
            onContinueRefine={continueRefine}
            messaging={messagingPort}
            onViewConfirm={(taskId) =>
              onRouteChange({ view: "confirm", taskId })
            }
          />
        );
      case "share":
        return (
          <SummaryShareRoute
            key={`${currentRoute.shareId}:${Boolean(currentRoute.preview)}`}
            route={currentRoute}
            onRouteChange={onRouteChange}
            messaging={messagingPort}
          />
        );
      case "confirm":
        return (
          <SummaryConfirmPage
            key={currentRoute.taskId}
            taskId={currentRoute.taskId}
            onBack={() => showDetail(currentRoute.taskId)}
            onDeclined={refreshListAndShow}
          />
        );
      case "schedules":
        return <ScheduleListPage onBack={showList} refreshKey={listRefreshKey + backgroundRefreshKey} />;
      case "list":
        return null;
    }
  };

  return (
    <SummaryMessagingProvider value={messagingPort}>
      <div
        className={`summary-workspace summary-workspace--${route.view}`}
        data-testid="summary-workspace"
      >
        <aside className="summary-workspace__list">
          <SummaryListPage
            embedded
            refreshKey={listRefreshKey}
            backgroundRefreshKey={backgroundRefreshKey}
            onCreateNew={showCreate}
            onViewDetail={showDetail}
            onContinueOptimize={continueRefine}
          />
        </aside>
        {route.view !== "list" ? (
          <main className="summary-workspace__content" data-desktop-chrome="surface">
            <button
              type="button"
              className="summary-workspace__mobile-back"
              onClick={showList}
              aria-label={t("summary.chatSummary.back")}
            >
              <ChevronLeft size={18} />
              <span>{t("summary.chatSummary.back")}</span>
            </button>
            <div className="summary-workspace__page">{renderContent(route)}</div>
          </main>
        ) : null}
      </div>
    </SummaryMessagingProvider>
  );
}

export { SummaryWorkspace };
