import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatPage,
  applyImSpaceContext,
  createCurrentEmptyImConversation,
  findCurrentImConversation,
  getCurrentImChannelInfo,
  getCurrentImUnreadObserver,
  setCurrentImChannelInfoCache,
  ThemeMode,
  WKApp,
  WKBase,
  WKLayout,
  i18n,
  t,
  useI18n,
} from "@octo/base";
import WKNavHeader from "@octo/base/src/Components/WKNavHeader";
import type { WKViewQueueContext } from "@octo/base/src/Components/WKViewQueue";
import type { ChatContentPageProps } from "@octo/base/src/Pages/Chat";
import { ContactsList } from "@octo/contacts";
import { renderAppBotConversation } from "@dmwork/appbot/conversation";
import { Channel, ChannelInfo } from "wukongimjssdk";
import {
  type CommunicationPage,
  type CommunicationPresentation,
  type ConversationTarget,
  type HostCommand,
  type NavigationReport,
  type OctoBuddyCommunicationBridge,
  type DocumentForwardRequest,
} from "./hostBridge";
import { createReadyReporter } from "./readyReporter";
import { Toast } from "@douyinfe/semi-ui";
import { installSummaryNavigation } from "./summaryNavigation";
import { installDocumentForward } from "./documentForward";
import { installSummaryRequests } from "./summaryRequests";
import { createWorkspaceNavigationGuard } from "./workspaceNavigationGuard";
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

function hasCompatibleTargetVariant(target: ConversationTarget): boolean {
  if (target.variant === "app-bot") return target.channelType === 1;
  if (target.variant === "workspace-group") return target.channelType === 2;
  return true;
}

function assertCompatibleTargetVariant(target: ConversationTarget): void {
  if (!hasCompatibleTargetVariant(target)) {
    throw new Error(`Incompatible ${target.variant} channelType: ${target.channelType}`);
  }
}

function openTarget(
  target: ConversationTarget,
  workspaceEmbedding?: ChatContentPageProps["workspaceEmbedding"],
  preserveCurrentConversation = false,
) {
  assertCompatibleTargetVariant(target);
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
    ...(workspaceEmbedding ? { workspaceEmbedding } : {}),
    ...(preserveCurrentConversation ? { preserveCurrentConversation: true } : {}),
  });
}

export function CommunicationShell({
  bridge,
  initialPage,
  initialSpaceId,
  initialPresentation,
  onReady,
  runtimeOwned = false,
  isDocumentForwardCurrent,
}: {
  bridge: OctoBuddyCommunicationBridge;
  initialPage: CommunicationPage;
  initialSpaceId: string;
  initialPresentation: CommunicationPresentation;
  onReady: (state: { page: CommunicationPage; spaceId: string }) => Promise<void>;
  runtimeOwned?: boolean;
  isDocumentForwardCurrent?: (request: DocumentForwardRequest) => boolean;
}) {
  const [activePage, setActivePage] = useState<CommunicationPage>(initialPage);
  const contactsTitle = useI18n().t("contacts.page.title");
  const [presentation, setPresentation] = useState<CommunicationPresentation>(initialPresentation);
  const activePageRef = useRef(activePage);
  const spaceIdRef = useRef(initialSpaceId);
  const summaryScopeRevision = useRef(0);
  const routeReadyRef = useRef({ left: false, right: false });
  const commandListenerReadyRef = useRef(false);
  const pendingTargetRef = useRef<ConversationTarget | undefined>();
  const appTargetRef = useRef<ConversationTarget | undefined>();
  const workspaceTargetRef = useRef<ConversationTarget | undefined>();
  const currentTargetRef = useRef<ConversationTarget | undefined>();
  const workspaceReturnTargetRef = useRef<Channel | undefined>();
  const workspaceNavigationGuard = useMemo(() => createWorkspaceNavigationGuard(), []);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyReporterRef = useRef<ReturnType<typeof createReadyReporter>>();

  const commitPreparedTarget = useCallback((target: ConversationTarget) => {
    const previous = workspaceTargetRef.current;
    const currentTarget = currentTargetRef.current;
    const channel = WKApp.shared.openChannel;
    if (target.variant !== "app-bot" && currentTarget?.channelId === target.channelId &&
        currentTarget.channelType === target.channelType && currentTarget.variant === target.variant &&
        currentTarget.messageSeq === target.messageSeq &&
        currentTarget.openChannelSearch === target.openChannelSearch &&
        channel?.channelID === target.channelId && channel.channelType === target.channelType) return;
    const preserveCurrentConversation = Boolean(
      !appTargetRef.current && (previous || target.variant === "workspace-group" ||
        (workspaceReturnTargetRef.current?.channelID === target.channelId &&
         workspaceReturnTargetRef.current.channelType === target.channelType)) &&
      channel?.channelID === target.channelId && channel.channelType === target.channelType &&
      !target.messageSeq && !target.openChannelSearch
    );
    workspaceReturnTargetRef.current = undefined;
    currentTargetRef.current = target;
    appTargetRef.current = target.variant === "app-bot" ? target : undefined;
    workspaceTargetRef.current = target.variant === "workspace-group" ? target : undefined;
    const spaceId = spaceIdRef.current;
    openTarget(target, target.variant === "workspace-group" ? {
      openConversation: (channel) => {
        if (workspaceTargetRef.current !== target || spaceIdRef.current !== spaceId) return;
        workspaceNavigationGuard.run(() => {
          if (workspaceTargetRef.current !== target || spaceIdRef.current !== spaceId) return;
          reportNavigation(bridge, {
            page: "chat",
            source: "workspace-conversation",
            channel: { id: channel.channelID, type: channel.channelType },
          });
        });
      },
      onSidePanelUnavailable: () => {
        if (workspaceTargetRef.current !== target || spaceIdRef.current !== spaceId) return;
        Toast.info(t("app.workspaceConversation.openInMessages"));
      },
    } : undefined, preserveCurrentConversation);
  }, [bridge, workspaceNavigationGuard]);

  const openPreparedTarget = useCallback((target: ConversationTarget) => {
    const current = WKApp.shared.openChannel;
    const previousWorkspace = workspaceTargetRef.current;
    const spaceId = spaceIdRef.current;
    const replacingConversation = current && (
      current.channelID !== target.channelId || current.channelType !== target.channelType ||
      Boolean(target.messageSeq || target.openChannelSearch)
    );
    if (target.variant !== "workspace-group" || !replacingConversation) {
      commitPreparedTarget(target);
      return;
    }
    workspaceNavigationGuard.run(() => commitPreparedTarget(target), () => {
      if (spaceIdRef.current !== spaceId) return;
      // Returning to the original full-page conversation is presentation-only.
      if (!previousWorkspace) workspaceReturnTargetRef.current = current;
      reportNavigation(bridge, {
        page: "chat",
        source: previousWorkspace ? "workspace-selection-cancelled" : "workspace-conversation",
        channel: { id: current.channelID, type: current.channelType },
        ...(previousWorkspace ? {
          cancelledTarget: { id: target.channelId, type: target.channelType },
        } : {}),
      });
    });
  }, [bridge, commitPreparedTarget, workspaceNavigationGuard]);

  useEffect(() => () => workspaceNavigationGuard.cancel(), [workspaceNavigationGuard]);

  useEffect(() => installSummaryNavigation(bridge, (error) => {
    console.error("[client-communication] failed to open summary", error);
    Toast.error(t("summary.common.operationFailed"));
  }), [bridge]);
  useEffect(() => installDocumentForward(bridge, {
    getSpaceId: () => spaceIdRef.current,
    getContext: () => WKApp.shared.baseContext,
    isRequestCurrent: isDocumentForwardCurrent,
  }), [bridge, isDocumentForwardCurrent]);

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
        if (command.target && !hasCompatibleTargetVariant(command.target)) {
          console.error("[client-communication] rejected incompatible conversation target", command.target);
          return;
        }
        workspaceNavigationGuard.cancel();
        if (command.presentation) setPresentation(command.presentation);
        if (command.page !== activePageRef.current) {
          WKApp.routeLeft.popToRoot();
          if (command.page === "contacts") WKApp.routeRight.popToRoot();
        }
        // Leaving a specialized conversation restores the normal Messages behavior.
        const previousTarget = pendingTargetRef.current || appTargetRef.current || workspaceTargetRef.current;
        const target = command.target || (command.page === "chat" && previousTarget ? {
          ...previousTarget,
          variant: undefined,
        } : undefined);
        if (command.page !== "chat") {
          currentTargetRef.current = undefined;
          appTargetRef.current = undefined;
          workspaceTargetRef.current = undefined;
        }
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
        workspaceNavigationGuard.cancel();
        pendingTargetRef.current = undefined;
        currentTargetRef.current = undefined;
        appTargetRef.current = undefined;
        workspaceReturnTargetRef.current = undefined;
        if (workspaceTargetRef.current) WKApp.routeRight.popToRoot();
        workspaceTargetRef.current = undefined;
        if (spaceIdRef.current !== command.space.id) summaryScopeRevision.current++;
        spaceIdRef.current = command.space.id;
        document.documentElement.dataset.spaceId = command.space.id;
        if (!runtimeOwned) {
          applyImSpaceContext({
            space_id: command.space.id,
            name: command.space.name,
          });
        }
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
        workspaceNavigationGuard.cancel();
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
        if (command.type === "suspend") {
          workspaceNavigationGuard.cancel();
          if (pendingTargetRef.current?.variant === "workspace-group") pendingTargetRef.current = undefined;
        }
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
  }, [activatePage, initialPage, openPreparedTarget, reportReadyWhenPrepared, runtimeOwned, workspaceNavigationGuard]);

  useEffect(() => {
    if (runtimeOwned) return;
    return getCurrentImUnreadObserver().subscribe((count) => reportUnread(bridge, count));
  }, [bridge, runtimeOwned]);

  useEffect(() => {
    if (runtimeOwned) return;
    return installSummaryRequests(bridge, {
      capture: (request) => {
        const revision = summaryScopeRevision.current;
        return () => revision === summaryScopeRevision.current && request.spaceId === spaceIdRef.current;
      },
    });
  }, [bridge, runtimeOwned]);

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
        source: workspaceTargetRef.current &&
          (workspaceTargetRef.current.channelId !== channel.channelID ||
           workspaceTargetRef.current.channelType !== channel.channelType)
          ? "workspace-conversation" : "internal",
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
        <div className="communication-contacts">
          <WKNavHeader className="communication-contacts-header" title={contactsTitle} />
          <div className="communication-contacts-body"><ContactsList /></div>
        </div>
      </div>
    </div>
  ), [activePage, contactsTitle]);

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
