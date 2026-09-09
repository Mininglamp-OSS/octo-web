import React from "react";
import { Dap, Menus, t as translate, WKApp } from "@octo/base";
import { SMALL_SCREEN_WIDTH } from "@octo/base/src/Components/WKLayout/layoutWidth";
import { getSummaryShare } from "../api/summaryApi";
import SummarySharePreviewFeature from "../features/summaryShare/SummarySharePreviewFeature";
import {
  getOriginalSummaryTaskId,
  shouldOpenOriginalSummary,
} from "../features/summaryShare/navigation";
import ScheduleListPage from "../pages/ScheduleListPage";
import SummaryConfirmPage from "../pages/SummaryConfirmPage";
import SummaryWorkbenchCreateEntry from "../features/summaryWorkbench/SummaryWorkbenchCreateEntry";
import SummaryDetailPage from "../pages/SummaryDetailPage";
import SummaryListPage from "../pages/SummaryListPage";
import SummaryShareDetailPage from "../pages/SummaryShareDetailPage";
import { getSummaryAttentionBadge } from "../utils/summaryAttentionBadge";

const openingSummaryShares = new Set<string>();
let summaryHomeEntrySeq = 0;
let openChatWithReferenceHandler: EventListener | null = null;

function afterSummaryMenuSwitch(action: () => void) {
  if (WKApp.switchToMenuById && WKApp.currentMenuId !== "summary") {
    WKApp.switchToMenuById("summary", action);
    return;
  }
  action();
}

function SummaryMenuIcon(_props: { active?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(0 1.66665)" fill="currentColor">
        <path d="M9.58333 0C8.89298 0 8.33333 0.559644 8.33333 1.25C8.33333 1.79426 8.68117 2.25727 9.16667 2.42887V4.16667H4.58333C3.66286 4.16667 2.91667 4.91286 2.91667 5.83333V15C2.91667 15.9205 3.66286 16.6667 4.58333 16.6667H15.4167C16.3371 16.6667 17.0833 15.9205 17.0833 15V5.83333C17.0833 4.91286 16.3371 4.16667 15.4167 4.16667H10.8333V2.42887C11.3188 2.25727 11.6667 1.79426 11.6667 1.25C11.6667 0.559644 11.107 0 10.4167 0H9.58333ZM5.83333 10.4167C5.83333 9.72631 6.39298 9.16667 7.08333 9.16667C7.77369 9.16667 8.33333 9.72631 8.33333 10.4167C8.33333 11.107 7.77369 11.6667 7.08333 11.6667C6.39298 11.6667 5.83333 11.107 5.83333 10.4167ZM12.9167 9.16667C13.607 9.16667 14.1667 9.72631 14.1667 10.4167C14.1667 11.107 13.607 11.6667 12.9167 11.6667C12.2263 11.6667 11.6667 11.107 11.6667 10.4167C11.6667 9.72631 12.2263 9.16667 12.9167 9.16667Z" />
        <path d="M1.66667 9.16667C1.66667 8.70643 1.29357 8.33333 0.833333 8.33333C0.373096 8.33333 0 8.70643 0 9.16667V11.6667C0 12.1269 0.373096 12.5 0.833333 12.5C1.29357 12.5 1.66667 12.1269 1.66667 11.6667V9.16667Z" />
        <path d="M19.1667 8.33333C18.7064 8.33333 18.3333 8.70643 18.3333 9.16667V11.6667C18.3333 12.1269 18.7064 12.5 19.1667 12.5C19.6269 12.5 20 12.1269 20 11.6667V9.16667Z" />
      </g>
    </svg>
  );
}

export function registerSummaryLegacyNavigation(): void {
  WKApp.openSummaryDetail = (
    taskId: number | string,
    spaceId,
    originChannel
  ) => {
    afterSummaryMenuSwitch(() => {
      if (spaceId) WKApp.shared.currentSpaceId = spaceId;
      WKApp.routeLeft.popToRoot();
      WKApp.routeRight.replaceToRoot(
        <SummaryDetailPage
          taskId={taskId}
          originChannel={originChannel}
          emitSelection
        />
      );
    });
  };

  WKApp.openSummarySharePreview = (shareId, spaceId, originChannel) => {
    if (spaceId) WKApp.shared.currentSpaceId = spaceId;
    const close = () => WKApp.shared.baseContext.hideGlobalModal();
    WKApp.shared.baseContext.showGlobalModal({
      width: "800px",
      closable: false,
      footer: null,
      onCancel: close,
      body: (
        <SummarySharePreviewFeature
          shareId={shareId}
          onClose={close}
          onOpenDetail={() => {
            close();
            WKApp.openSummaryShareDetail?.(shareId, spaceId, originChannel);
          }}
        />
      ),
    });
  };

  WKApp.openSummaryShareDetail = async (shareId, spaceId, originChannel) => {
    if (openingSummaryShares.has(shareId)) return;
    openingSummaryShares.add(shareId);
    try {
      const share = await getSummaryShare(shareId, spaceId);
      if (shouldOpenOriginalSummary(share) && WKApp.openSummaryDetail) {
        WKApp.openSummaryDetail(
          getOriginalSummaryTaskId(share),
          share.snapshot.space_id || spaceId,
          originChannel
        );
        return;
      }
    } catch {
      // The shared page owns unavailable and error rendering.
    } finally {
      openingSummaryShares.delete(shareId);
    }

    afterSummaryMenuSwitch(() => {
      if (spaceId) WKApp.shared.currentSpaceId = spaceId;
      const query = spaceId ? `?sp=${encodeURIComponent(spaceId)}` : "";
      window.history.pushState(
        {},
        "",
        `/s/share/${encodeURIComponent(shareId)}${query}`
      );
      WKApp.routeLeft.popToRoot();
      WKApp.routeRight.replaceToRoot(
        <SummaryShareDetailPage
          shareId={shareId}
          originChannel={originChannel}
        />
      );
    });
  };

  WKApp.route.register("/summary", () => <SummaryListPage />);
  WKApp.route.register("/summary/create", () => (
    <SummaryWorkbenchCreateEntry source="summary_home" legacyInitialMode="normal" />
  ));

  openChatWithReferenceHandler = ((event: CustomEvent) => {
    const task = event.detail;
    if (!task || !task.task_id) return;
    WKApp.routeRight.push(
      <SummaryWorkbenchCreateEntry derivedFromTask={task} source="detail_optimize" legacyInitialMode="agent" />
    );
  }) as EventListener;
  window.addEventListener(
    "summary-open-chat-with-reference",
    openChatWithReferenceHandler
  );

  WKApp.route.register("/summary/detail", (param: any) => (
    <SummaryDetailPage taskId={param?.taskId} emitSelection />
  ));
  WKApp.route.register("/summary/share", (param: any) => (
    <SummaryShareDetailPage shareId={param?.shareId} />
  ));
  WKApp.route.register("/summary/confirm", (param: any) => (
    <SummaryConfirmPage taskId={param?.taskId} />
  ));
  WKApp.route.register("/summary/schedules", () => <ScheduleListPage />);

  WKApp.menus.register(
    "summary",
    () => {
      const menu = new Menus(
        "summary",
        "/summary",
        translate("summary.menu.title"),
        <SummaryMenuIcon />,
        <SummaryMenuIcon active />
      );
      menu.badge = getSummaryAttentionBadge();
      menu.onPress = (reentry?: boolean) => {
        if (!reentry) Dap.shared.track("smart_summary_module_entered", {});
        WKApp.routeLeft.popToRoot();
        if (window.innerWidth <= SMALL_SCREEN_WIDTH) {
          WKApp.routeRight.popToRoot();
          return;
        }
        WKApp.routeRight.replaceToRoot(
          <SummaryWorkbenchCreateEntry
            source="summary_home"
            key={`home-workbench-${++summaryHomeEntrySeq}`}
            legacyInitialMode="normal"
          />
        );
      };
      return menu;
    },
    4002
  );
}

export function disposeSummaryLegacyNavigation(): void {
  if (openChatWithReferenceHandler && typeof window !== "undefined") {
    window.removeEventListener(
      "summary-open-chat-with-reference",
      openChatWithReferenceHandler
    );
  }
  openChatWithReferenceHandler = null;
  openingSummaryShares.clear();
}
