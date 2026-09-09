import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatPage,
  createCurrentEmptyImConversation,
  findCurrentImConversation,
  getCurrentImChannelInfo,
  setCurrentImChannelInfoCache,
  ThemeMode,
  WKApp,
  WKBase,
  WKLayout,
  i18n,
  t,
} from "@octo/base";
import type { WKViewQueueContext } from "@octo/base/src/Components/WKViewQueue";
import { ContactsList } from "@octo/contacts";
import { renderAppBotConversation } from "@dmwork/appbot/conversation";
import type {
  SummaryCompletionNotice,
  SummaryConversationTarget,
} from "@dmwork/summary/messaging";
import { Channel, ChannelInfo, WKSDK } from "wukongimjssdk";
import { getElectronUnreadMessageCount } from "../App/electronUnreadCount";
import {
  type CommunicationPage,
  type CommunicationPresentation,
  type ConversationTarget,
  type HostCommand,
  type NavigationReport,
  type OctoBuddyCommunicationBridge,
  type SummaryCapabilityRequest,
} from "./hostBridge";
import { createReadyReporter } from "./readyReporter";
import { Toast } from "@douyinfe/semi-ui";
import { installSummaryNavigation } from "./summaryNavigation";
import { installDocumentForward } from "./documentForward";
import "./index.css";

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

function reportNavigation(
  bridge: OctoBuddyCommunicationBridge,
  report: NavigationReport,
) {
  void Promise.resolve()
    .then(() => bridge.reportNavigation(report))
    .catch((error: unknown) => {
      console.error("[client-communication] failed to report navigation", error);
    });
}

function reportUnread(bridge: OctoBuddyCommunicationBridge, count: number) {
  try {
    bridge.reportUnread(count);
  } catch (error) {
    console.error("[client-communication] failed to report unread count", error);
  }
}

function openTarget(target: ConversationTarget) {
  const channel = new Channel(target.channelId, target.channelType);
  if (target.displayName || target.avatar || target.metadata) {
    const info = getCurrentImChannelInfo<Channel, ChannelInfo>(channel) || new ChannelInfo();
    info.channel = channel;
    if (target.displayName) info.title = target.displayName;
    else if (!info.title) info.title = target.channelId;
    if (target.avatar) info.logo = target.avatar;
    const existingMetadata = info.orgData && typeof info.orgData === "object"
      ? info.orgData
      : {};
    info.orgData = {
      ...existingMetadata,
      ...(target.metadata || {}),
    };
    setCurrentImChannelInfoCache(info);
    if (!findCurrentImConversation(channel)) {
      createCurrentEmptyImConversation(channel);
    }
  }
  if (target.variant === "app-bot") {
    WKApp.shared.openChannel = channel;
    WKApp.routeRight.replaceToRoot(renderAppBotConversation({
      channelId: target.channelId,
      displayName: target.displayName || target.channelId,
    }, channel));
    WKApp.shared.notifyListener();
    return;
  }
  WKApp.endpoints.showConversation(channel, {
    initLocateMessageSeq: target.messageSeq,
    openChannelSearch: target.openChannelSearch,
  });
}

export function CommunicationShell({
  bridge,
  initialPage,
  initialSpaceId,
  initialPresentation,
  onReady,
}: {
  bridge: OctoBuddyCommunicationBridge;
  initialPage: CommunicationPage;
  initialSpaceId: string;
  initialPresentation: CommunicationPresentation;
  onReady: (state: { page: CommunicationPage; spaceId: string }) => Promise<void>;
}) {
  const [activePage, setActivePage] = useState<CommunicationPage>(initialPage);
  const [presentation, setPresentation] = useState<CommunicationPresentation>(initialPresentation);
  const activePageRef = useRef(activePage);
  const spaceIdRef = useRef(initialSpaceId);
  const summaryScopeRevision = useRef(0);
  const routeReadyRef = useRef({ left: false, right: false });
  const commandListenerReadyRef = useRef(false);
  const pendingTargetRef = useRef<ConversationTarget | undefined>();
  const appTargetRef = useRef<ConversationTarget | undefined>();
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyReporterRef = useRef<ReturnType<typeof createReadyReporter>>();

  const openPreparedTarget = useCallback((target: ConversationTarget) => {
    appTargetRef.current = target.variant === "app-bot" ? target : undefined;
    openTarget(target);
  }, []);

  useEffect(() => installSummaryNavigation(bridge, (error) => {
    console.error("[client-communication] failed to open summary", error);
    Toast.error(t("summary.common.operationFailed"));
  }), [bridge]);
  useEffect(() => installDocumentForward(bridge, {
    getSpaceId: () => spaceIdRef.current,
    getContext: () => WKApp.shared.baseContext,
  }), [bridge]);

  const reportReadyWhenPrepared = useCallback(() => {
    if (
      !commandListenerReadyRef.current ||
      !routeReadyRef.current.left ||
      !routeReadyRef.current.right
    ) return;
    readyReporterRef.current?.request();
  }, []);

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
    reportNavigation(bridge, { page, source });
    if (afterSwitch) window.setTimeout(afterSwitch, 0);
  }, [bridge]);

  useEffect(() => {
    const reporter = createReadyReporter(
      () => onReadyRef.current({
        page: activePageRef.current,
        spaceId: spaceIdRef.current,
      }),
      {
        onExhausted: (error) => {
          console.error("[client-communication] failed to report ready", error);
        },
      },
    );
    readyReporterRef.current = reporter;
    reportReadyWhenPrepared();

    return () => {
      reporter.dispose();
      if (readyReporterRef.current === reporter) {
        readyReporterRef.current = undefined;
      }
    };
  }, [reportReadyWhenPrepared]);

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
        // Leaving Apps restores the regular chat header, even without a new target.
        const previousTarget = pendingTargetRef.current || appTargetRef.current;
        const target = command.target || (command.page === "chat" && previousTarget ? {
          ...previousTarget,
          variant: undefined,
        } : undefined);
        if (command.page !== "chat") appTargetRef.current = undefined;
        pendingTargetRef.current = target;
        activatePage(command.page, "host", () => {
          if (pendingTargetRef.current && routeReadyRef.current.right) {
            const target = pendingTargetRef.current;
            pendingTargetRef.current = undefined;
            openPreparedTarget(target);
          }
        });
        return;
      }

      if (command.type === "spaceChanged") {
        pendingTargetRef.current = undefined;
        appTargetRef.current = undefined;
        if (spaceIdRef.current !== command.space.id) summaryScopeRevision.current++;
        spaceIdRef.current = command.space.id;
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
        document.documentElement.lang = command.locale;
        WKApp.shared.notifyListener();
        return;
      }

      if (command.type === "sessionRevoked") {
        WKApp.loginInfo.logout();
        window.location.reload();
        return;
      }
      if (command.type === "hostVisibilityChanged") {
        document.documentElement.dataset.hostVisibility = command.visible
          ? "visible"
          : "hidden";
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
  }, [activatePage, initialPage, openPreparedTarget, reportReadyWhenPrepared]);

  useEffect(() => {
    const syncUnread = () => reportUnread(bridge, getElectronUnreadMessageCount());
    const conversationManager = WKSDK.shared().conversationManager;
    conversationManager.addConversationListener(syncUnread);
    WKApp.mittBus.on("conversation-list-refreshed", syncUnread);
    syncUnread();
    return () => {
      conversationManager.removeConversationListener(syncUnread);
      WKApp.mittBus.off("conversation-list-refreshed", syncUnread);
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge.onSummaryRequest || !bridge.respondSummaryRequest) return;
    return bridge.onSummaryRequest((request: SummaryCapabilityRequest) => {
      const revision = summaryScopeRevision.current;
      const isActive = () => revision === summaryScopeRevision.current && request.spaceId === spaceIdRef.current;
      const respond = (response: { ok: boolean; result?: unknown; error?: string }) => {
        bridge.respondSummaryRequest?.({
          requestId: request.requestId,
          ...(isActive() ? response : { ok: false, error: "Summary request context expired" }),
        });
      };
      const run = async () => {
        if (!isActive()) throw new Error("Summary request context expired");
        const { legacySummaryMessagingPort } = await import(
          "@dmwork/summary/messaging"
        );
        if (!isActive()) throw new Error("Summary request context expired");
        if (request.operation === "loadConversationMembers") {
          const result = await legacySummaryMessagingPort.loadConversationMembers(
            request.payload as SummaryConversationTarget
          );
          respond({ ok: true, result });
          return;
        }
        if (request.operation === "notifySummaryCompleted") {
          await legacySummaryMessagingPort.notifySummaryCompleted(
            request.payload as SummaryCompletionNotice
          );
          respond({ ok: true });
          return;
        }
        if (request.operation === "requestForward") {
          const input = request.payload as { content?: unknown; title?: unknown };
          const content = typeof input?.content === "string" ? input.content : "";
          const title = typeof input?.title === "string" ? input.title : "";
          legacySummaryMessagingPort.requestForward({
            isActive,
            content,
            title,
            onComplete: (result) => respond({ ok: true, result }),
            onError: (error) => respond({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
            onCancel: () => respond({ ok: true, result: null }),
          });
          return;
        }
        throw new Error(`Unsupported summary capability: ${request.operation}`);
      };
      void run().catch((error) => respond({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }, [bridge]);

  useEffect(() => {
    let previousChannel = "";
    const reportOpenChannel = () => {
      const channel = WKApp.shared.openChannel;
      if (!channel) return;
      const key = `${channel.channelID}:${channel.channelType}`;
      if (key === previousChannel) return;
      previousChannel = key;
      reportNavigation(bridge, {
        page: "chat",
        source: "internal",
        channel: { id: channel.channelID, type: channel.channelType },
      });
    };
    const unsubscribe = WKApp.shared.addListener(reportOpenChannel);
    reportOpenChannel();
    return unsubscribe;
  }, [bridge]);

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
              openPreparedTarget(target);
            }
          }}
        />
      </div>
    </WKBase>
  );
}
