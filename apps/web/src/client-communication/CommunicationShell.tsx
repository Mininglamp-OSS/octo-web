import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatPage,
  ThemeMode,
  WKApp,
  WKBase,
  WKLayout,
  i18n,
} from "@octo/base";
import type { WKViewQueueContext } from "@octo/base/src/Components/WKViewQueue";
import { ContactsList } from "@octo/contacts";
import { Channel, WKSDK } from "wukongimjssdk";
import { getElectronUnreadMessageCount } from "../App/electronUnreadCount";
import {
  requireHostBridge,
  type CommunicationPage,
  type CommunicationPresentation,
  type ConversationTarget,
  type HostCommand,
  type NavigationReport,
} from "./hostBridge";
import "./index.css";

const bridge = requireHostBridge();

function bindLeftRoute(context: WKViewQueueContext) {
  WKApp.routeLeft.setPush = (view) => context.push(view);
  WKApp.routeLeft.setReplaceToRoot = (view) => context.replaceToRoot(view);
  WKApp.routeLeft.setPop = () => context.pop();
  WKApp.routeLeft.setPopToRoot = () => context.popToRoot();
}

function bindRightRoute(context: WKViewQueueContext) {
  WKApp.routeRight.setPush = (view) => context.push(view);
  WKApp.routeRight.setReplaceToRoot = (view) => context.replaceToRoot(view);
  WKApp.routeRight.setPop = () => context.pop();
  WKApp.routeRight.setPopToRoot = () => context.popToRoot();
}

function reportNavigation(report: NavigationReport) {
  void bridge.reportNavigation(report);
}

function openTarget(target: ConversationTarget) {
  WKApp.endpoints.showConversation(
    new Channel(target.channelId, target.channelType),
    {
      initLocateMessageSeq: target.messageSeq,
      openChannelSearch: target.openChannelSearch,
    },
  );
}

export function CommunicationShell({
  initialPage,
  initialPresentation,
  onReady,
}: {
  initialPage: CommunicationPage;
  initialPresentation: CommunicationPresentation;
  onReady: () => Promise<void>;
}) {
  const [activePage, setActivePage] = useState<CommunicationPage>(initialPage);
  const [presentation, setPresentation] = useState<CommunicationPresentation>(initialPresentation);
  const activePageRef = useRef(activePage);
  const routeReadyRef = useRef({ left: false, right: false });
  const commandListenerReadyRef = useRef(false);
  const readyReportedRef = useRef(false);
  const pendingTargetRef = useRef<ConversationTarget | undefined>();

  const reportReadyWhenPrepared = useCallback(() => {
    if (
      readyReportedRef.current ||
      !commandListenerReadyRef.current ||
      !routeReadyRef.current.left ||
      !routeReadyRef.current.right
    ) return;
    readyReportedRef.current = true;
    void onReady();
  }, [onReady]);

  const markRouteReady = useCallback((side: "left" | "right") => {
    routeReadyRef.current[side] = true;
    reportReadyWhenPrepared();
  }, [reportReadyWhenPrepared]);

  const activatePage = useCallback((
    page: CommunicationPage,
    source: NavigationReport["source"],
    afterSwitch?: () => void,
  ) => {
    activePageRef.current = page;
    WKApp.currentMenuId = page;
    WKApp.mittBus.emit("wk:active-menu-changed", { menuId: page });
    setActivePage(page);
    reportNavigation({ page, source });
    requestAnimationFrame(() => requestAnimationFrame(() => afterSwitch?.()));
  }, []);

  useEffect(() => {
    WKApp.currentMenuId = initialPage;
    WKApp.switchToMenuById = (menuId, afterSwitch) => {
      if (menuId !== "chat" && menuId !== "contacts") return;
      activatePage(menuId, "internal", afterSwitch);
    };

    const dispose = bridge.onCommand((command: HostCommand) => {
      if (command.type === "navigate") {
        if (command.presentation) setPresentation(command.presentation);
        if (command.page !== activePageRef.current) {
          WKApp.routeLeft.popToRoot();
          if (command.page === "contacts") WKApp.routeRight.popToRoot();
        }
        pendingTargetRef.current = command.target;
        activatePage(command.page, "host", () => {
          if (pendingTargetRef.current && routeReadyRef.current.right) {
            const target = pendingTargetRef.current;
            pendingTargetRef.current = undefined;
            openTarget(target);
          }
        });
        return;
      }

      if (command.type === "spaceChanged") {
        WKApp.shared.currentSpaceId = command.space.id;
        document.documentElement.dataset.spaceId = command.space.id;
        WKApp.mittBus.emit("space-changed", {
          space_id: command.space.id,
          name: command.space.name,
        });
        WKApp.shared.notifyListener();
        return;
      }

      if (command.type === "appearanceChanged") {
        WKApp.config.themeMode = command.theme === "dark" ? ThemeMode.dark : ThemeMode.light;
        WKApp.config.locale = command.locale;
        i18n.setLocale(command.locale, { persist: false });
        document.documentElement.dataset.theme = command.theme;
        WKApp.shared.notifyListener();
        return;
      }

      if (command.type === "sessionRevoked") {
        window.location.reload();
        return;
      }

      if (command.type === "suspend" || command.type === "resume") {
        document.documentElement.dataset.hostVisibility = command.type === "suspend" ? "hidden" : "visible";
        window.dispatchEvent(new CustomEvent(`octobuddy:${command.type}`));
      }
    });
    commandListenerReadyRef.current = true;
    reportReadyWhenPrepared();

    return () => {
      commandListenerReadyRef.current = false;
      dispose();
      WKApp.switchToMenuById = undefined;
    };
  }, [activatePage, initialPage, reportReadyWhenPrepared]);

  useEffect(() => {
    const syncUnread = () => bridge.reportUnread(getElectronUnreadMessageCount());
    const conversationManager = WKSDK.shared().conversationManager;
    conversationManager.addConversationListener(syncUnread);
    WKApp.mittBus.on("conversation-list-refreshed", syncUnread);
    syncUnread();
    return () => {
      conversationManager.removeConversationListener(syncUnread);
      WKApp.mittBus.off("conversation-list-refreshed", syncUnread);
    };
  }, []);

  useEffect(() => {
    let previousChannel = "";
    const reportOpenChannel = () => {
      const channel = WKApp.shared.openChannel;
      if (!channel) return;
      const key = `${channel.channelID}:${channel.channelType}`;
      if (key === previousChannel) return;
      previousChannel = key;
      reportNavigation({
        page: "chat",
        source: "internal",
        channel: { id: channel.channelID, type: channel.channelType },
      });
    };
    const unsubscribe = WKApp.shared.addListener(reportOpenChannel);
    reportOpenChannel();
    return unsubscribe;
  }, []);

  const leftContent = useMemo(() => (
    <div className="communication-page-stack">
      <div className="communication-page" style={{ display: activePage === "chat" ? "block" : "none" }}>
        <ChatPage />
      </div>
      <div className="communication-page" style={{ display: activePage === "contacts" ? "block" : "none" }}>
        <ContactsList />
      </div>
    </div>
  ), [activePage]);

  return (
    <WKBase onContext={(context) => {
      WKApp.shared.baseContext = context;
    }}>
      <div className={`communication-shell communication-shell--${presentation}`}>
        <WKLayout
          embedded
          contentLeft={leftContent}
          contentRight={<div className="communication-empty-state" />}
          onLeftContext={(context) => {
            bindLeftRoute(context);
            markRouteReady("left");
          }}
          onRightContext={(context) => {
            bindRightRoute(context);
            markRouteReady("right");
            const target = pendingTargetRef.current;
            if (target) {
              pendingTargetRef.current = undefined;
              openTarget(target);
            }
          }}
        />
      </div>
    </WKBase>
  );
}
