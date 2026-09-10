import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
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
import { type SummaryDetailAction } from "../bridge/summaryWorkbench/detailAction";
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
  const [detailAction, setDetailAction] = useState<SummaryDetailAction>();
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
  const showCreate = (mode: "normal" | "agent" | "unified" = "normal") =>
    onRouteChange({ view: "create", mode: mode === "unified" ? "normal" : mode, source: "summary_list" });
  const showDetail = (taskId: number, action?: SummaryDetailAction) => {
    setDetailAction(action);
    onRouteChange({ view: "detail", taskId });
  };
  const refreshListAndShow = () => {
    refreshList();
    showList();
  };
  // 继续优化：引用当前总结、进入 agent 会话，产出一条**全新**总结（挂 referenced_task_ids，
  // 由 agent 自动判定轻量 refine 还是完整工具链 + 重新检索）。因此路由到 create/derived，
  // 而不是停留在当前详情页做同总结改写（后者是旧的 same-summary refine 行为，已废弃）。
  const continueRefine = (task: SummaryReferenceTask) =>
    onRouteChange({
      view: "create",
      mode: "agent",
      source: "continue_refine",
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
              refreshList();
              showDetail(taskId);
            }}
          />
        );
      case "detail":
        return (
          <SummaryDetailPage
            taskId={currentRoute.taskId}
            requestedAction={detailAction}
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
          />
        </aside>
        {route.view !== "list" ? (
          <main className="summary-workspace__content">
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
