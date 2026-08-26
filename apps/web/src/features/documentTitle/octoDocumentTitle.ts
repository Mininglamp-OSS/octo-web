import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  ConversationAction,
  WKSDK,
} from "wukongimjssdk";
import {
  ChannelTypeCommunityTopic,
  ConversationWrap,
  ThreadStatus,
  WKApp,
  addImChannelInfoListener,
  countEffectiveUnreadConversations,
  getBrowserUnreadConversationSync,
  isEffectivelyMuted,
  i18n,
  parseThreadChannelId,
  shouldSkipChannelForSpace,
  shouldSkipPersonConversationForSpace,
  titleContextStore,
  type UnreadConversationCandidate,
} from "@octo/base";
import {
  DocumentTitleController,
  resolveTitleMenuId,
} from "./DocumentTitleController";

function effectiveUnreadCandidates(): UnreadConversationCandidate[] {
  return WKSDK.shared().conversationManager.conversations.map(
    (conversation) => {
      const channel = conversation.channel;
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
      const isThread = channel.channelType === ChannelTypeCommunityTopic;
      const parentGroupNo = isThread
        ? (channelInfo?.orgData?.parentGroupNo as string | undefined) ||
          parseThreadChannelId(channel.channelID)?.groupNo
        : undefined;
      const parentChannelInfo = parentGroupNo
        ? WKSDK.shared().channelManager.getChannelInfo(
            new Channel(parentGroupNo, ChannelTypeGroup)
          )
        : undefined;
      const threadStatus = channelInfo?.orgData?.thread?.status as
        | number
        | undefined;
      const wrapped = new ConversationWrap(conversation);

      return {
        unread: wrapped.unread,
        crossSpace:
          shouldSkipChannelForSpace(channel) ||
          (channel.channelType === ChannelTypePerson &&
            shouldSkipPersonConversationForSpace(conversation)),
        effectivelyMuted: isEffectivelyMuted({
          isThread,
          channelInfo,
          parentChannelInfo,
        }),
        archived:
          isThread &&
          threadStatus !== undefined &&
          threadStatus !== ThreadStatus.Active,
      };
    }
  );
}

export function getEffectiveUnreadConversationCount(): number {
  return countEffectiveUnreadConversations(effectiveUnreadCandidates());
}

function subscribeActiveMenu(listener: () => void): () => void {
  const handler = () => listener();
  WKApp.mittBus.on("wk:active-menu-changed", handler);
  return () => WKApp.mittBus.off("wk:active-menu-changed", handler);
}

function subscribeAuthChanges(listener: () => void): () => void {
  const handler = () => listener();
  WKApp.mittBus.on("wk:auth-state-changed", handler);
  return () => WKApp.mittBus.off("wk:auth-state-changed", handler);
}

function subscribeUnreadChanges(listener: () => void): () => void {
  const sdk = WKSDK.shared();
  const conversationListener = () => listener();
  const channelUnsubscribe = addImChannelInfoListener(sdk, () => listener());
  const spaceChanged = () => listener();
  const conversationsRefreshed = () => listener();
  const unreadSyncUnsubscribe = getBrowserUnreadConversationSync().subscribe(
    (update) => {
      if (
        update.accountId !== WKApp.loginInfo.uid ||
        update.spaceId !== (WKApp.shared.currentSpaceId || "")
      ) {
        return;
      }
      const conversation = sdk.conversationManager.findConversation(
        new Channel(update.channelId, update.channelType)
      );
      if (!conversation) return;
      const unread = Math.max(0, update.unread);
      if (
        update.channelType === ChannelTypePerson &&
        conversation.extra?.spaceUnread !== undefined
      ) {
        conversation.extra.spaceUnread = unread;
      } else {
        conversation.unread = unread;
      }
      sdk.conversationManager.notifyConversationListeners(
        conversation,
        ConversationAction.update
      );
    }
  );

  sdk.conversationManager.addConversationListener(conversationListener);
  WKApp.mittBus.on("space-changed", spaceChanged);
  WKApp.mittBus.on("conversation-list-refreshed", conversationsRefreshed);

  return () => {
    sdk.conversationManager.removeConversationListener(conversationListener);
    channelUnsubscribe();
    unreadSyncUnsubscribe();
    WKApp.mittBus.off("space-changed", spaceChanged);
    WKApp.mittBus.off("conversation-list-refreshed", conversationsRefreshed);
  };
}

export function createOctoDocumentTitleController(): DocumentTitleController {
  return new DocumentTitleController({
    target: document,
    contexts: titleContextStore,
    getActiveMenu: () => {
      const menuId = resolveTitleMenuId(
        window.location.pathname,
        WKApp.currentMenuId
      );
      if (!menuId) return undefined;
      const activeMenu = WKApp.menus
        .menusList()
        .find((menu) => menu.id === menuId);
      return activeMenu
        ? { id: activeMenu.id, title: activeMenu.title }
        : { id: menuId, title: "" };
    },
    getUnreadConversationCount: getEffectiveUnreadConversationCount,
    getIsLoggedIn: () => WKApp.loginInfo.isLogined(),
    subscribeActiveMenu,
    subscribeUnreadChanges,
    subscribeAuthChanges,
    subscribeLocaleChanges: (listener) => i18n.subscribe(() => listener()),
    restoreUnreadState: async () => {
      // 未登录（含 token 过期已被清）时不要发 conversation/sync —— 否则必然 401，
      // 徒增无效请求并可能叠加到登出跳转的噪音里。登录态由 title 渲染的 getIsLoggedIn 兜底。
      if (!WKApp.loginInfo.isLogined()) return;
      const pathname = window.location.pathname;
      const menuId = resolveTitleMenuId(pathname, WKApp.currentMenuId);
      // ChatPage owns the normal conversation hydration. Other full-page modules
      // still need the same account-level unread snapshot for their title prefix.
      if (menuId === "chat" || (!menuId && pathname === "/")) return;
      await WKSDK.shared().conversationManager.sync({});
      // sync() replaces the SDK conversation cache without notifying its
      // conversation listeners. Broadcast the same event used by Chat so
      // consumers such as the Electron tray receive the restored snapshot.
      WKApp.mittBus.emit("conversation-list-refreshed");
    },
  });
}
