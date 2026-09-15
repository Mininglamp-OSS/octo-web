import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@octo/base";
import WKApp from "@octo/base/src/App";
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
import {
  clearSummaryWorkbenchNextCreate,
  markSummaryWorkbenchNextCreate,
} from "../features/summaryWorkbench/sessionStorage";
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

  useEffect(
    () => messagingPort.subscribeInvalidation(refreshList),
    [messagingPort, refreshList]
  );

  const showList = () => onRouteChange({ view: "list" });
  const showCreate = (mode: "normal" | "agent" | "unified" = "normal") => {
    clearSummaryWorkbenchNextCreate({
      userId: messagingPort.getCurrentUser().uid,
      spaceId: WKApp.shared.currentSpaceId,
    });
    onRouteChange({ view: "create", mode: mode === "unified" ? "normal" : mode, source: "summary_list" });
  };
  const showDetail = (taskId: number) =>
    onRouteChange({ view: "detail", taskId });
  const refreshListAndShow = () => {
    refreshList();
    showList();
  };
  // 六审 P1-1：「回首页新建」标记只应由**本工作台创建流产出的任务**的完成来 arm。
  // 详情视图还会以列表点击 / 深链 / 刷新等方式展示任意任务，那些完成与创建流无关，
  // 不得清掉用户保存的默认草稿。onSubmit 携带创建流刚产出的 taskId，以此为准。
  const createdTaskIdsRef = useRef<Set<number>>(new Set());
  const markNextHomeCreate = useCallback((taskId?: number) => {
    if (typeof taskId === "number" && !createdTaskIdsRef.current.has(taskId)) return;
    markSummaryWorkbenchNextCreate({
      userId: messagingPort.getCurrentUser().uid,
      spaceId: WKApp.shared.currentSpaceId,
    });
  }, [messagingPort]);
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
            }:${currentRoute.derivedFromTask?.task_id ?? "new"}`}
            legacyInitialMode={currentRoute.mode}
            source={currentRoute.source ?? "summary_home"}
            derivedFromTask={currentRoute.derivedFromTask}
            onOpenTask={showDetail}
            onCreated={refreshList}
            messaging={messagingPort}
            onSubmit={(taskId) => {
              createdTaskIdsRef.current.add(taskId);
              refreshList();
              showDetail(taskId);
            }}
          />
        );
      case "detail":
        return (
          <SummaryDetailPage
            taskId={currentRoute.taskId}
            originChannel={currentRoute.originConversation}
            emitSelection
            onAfterMutate={refreshListAndShow}
            onContinueRefine={continueRefine}
            onCompleted={markNextHomeCreate}
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
            taskId={currentRoute.taskId}
            onBack={() => showDetail(currentRoute.taskId)}
            onDeclined={refreshListAndShow}
          />
        );
      case "schedules":
        return <ScheduleListPage onBack={showList} />;
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
