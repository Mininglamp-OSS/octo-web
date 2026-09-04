import React, { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@octo/base";
import ScheduleListPage from "../pages/ScheduleListPage";
import SummaryConfirmPage from "../pages/SummaryConfirmPage";
import SummaryWorkbenchCreateEntry from "../features/summaryWorkbench/SummaryWorkbenchCreateEntry";
import SummaryDetailPage from "../pages/SummaryDetailPage";
import SummaryListPage from "../pages/SummaryListPage";
import SummaryShareDetailPage from "../pages/SummaryShareDetailPage";
import {
  getSummaryAttentionBadge,
  subscribeSummaryAttentionBadge,
} from "../utils/summaryAttentionBadge";
import type { SummaryReferenceTask } from "../types/summary";
import type { SummaryWorkspaceProps, SummaryWorkspaceRoute } from "./types";
import "./index.css";

export default function SummaryWorkspace({
  route,
  onRouteChange,
  onOpenConversation,
  onBadgeChange,
}: SummaryWorkspaceProps) {
  const { t } = useI18n();
  const [listRefreshKey, setListRefreshKey] = useState(0);

  useEffect(() => {
    if (!onBadgeChange) return undefined;
    try {
      onBadgeChange(getSummaryAttentionBadge());
    } catch (error) {
      console.warn("[SummaryWorkspace] Failed to report initial badge:", error);
    }
    return subscribeSummaryAttentionBadge(onBadgeChange);
  }, [onBadgeChange]);

  const showList = () => onRouteChange({ view: "list" });
  const showCreate = (mode: "normal" | "agent" | "unified" = "normal") =>
    onRouteChange({ view: "create", mode: mode === "unified" ? "normal" : mode, source: "summary_list" });
  const showDetail = (taskId: number) =>
    onRouteChange({ view: "detail", taskId });
  const refreshList = () => setListRefreshKey((value) => value + 1);
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
            }:${currentRoute.derivedFromTask?.task_id ?? "new"}`}
            legacyInitialMode={currentRoute.mode}
            source={currentRoute.source ?? "summary_home"}
            derivedFromTask={currentRoute.derivedFromTask}
            onOpenTask={showDetail}
            onCreated={refreshList}
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
            emitSelection
            onAfterMutate={refreshListAndShow}
            onContinueRefine={continueRefine}
            onViewConfirm={(taskId) =>
              onRouteChange({ view: "confirm", taskId })
            }
          />
        );
      case "share":
        return (
          <SummaryShareDetailPage
            shareId={currentRoute.shareId}
            originChannel={currentRoute.originConversation}
            onOpenConversation={onOpenConversation}
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
  );
}

export { SummaryWorkspace };
