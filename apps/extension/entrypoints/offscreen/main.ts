import { Convert, apiFetchJson, isApiFetchError } from "@octo/base";
import {
  Channel,
  ChannelInfo,
  ChannelTypeGroup,
  ChannelTypePerson,
  ConnectStatus,
  Conversation,
  Message,
  WKSDK,
} from "wukongimjssdk";
import {
  EXTENSION_MESSAGE_TYPE,
  buildNotificationId,
  normalizeApiURL,
  type ExtensionAuthResponse,
  type ExtensionAuthState,
  type ExtensionRuntimeMessage,
} from "../../utils/extensionRuntime";

type EntityInfo = {
  uid?: string;
  group_no?: string;
  channel_id?: string;
  name?: string;
  remark?: string;
  mute?: number;
  space_id?: string;
};

type SyncConversationsResponse = {
  conversations?: Array<Record<string, any>>;
  users?: EntityInfo[];
  groups?: EntityInfo[];
};

const SYSTEM_BOTS = new Set(["botfather"]);
const sdk = WKSDK.shared();

let currentAuth: ExtensionAuthState | null = null;
let currentConnectAddrs: string[] = [];
let connectAddrUsed = false;
let channelSpaceMap = new Map<string, string>();
let listenersRegistered = false;

function getChannelKey(channel: Channel): string {
  return `${channel.channelID}_${channel.channelType}`;
}

function getConversationTarget(channel: Channel) {
  return {
    channelId: channel.channelID,
    channelType: channel.channelType,
  };
}

function isSameSession(
  left: ExtensionAuthState | null,
  right: ExtensionAuthState | null,
): boolean {
  return (
    !!left &&
    !!right &&
    left.uid === right.uid &&
    left.token === right.token &&
    normalizeApiURL(left.apiURL) === normalizeApiURL(right.apiURL)
  );
}

function resetSdkCaches(): void {
  channelSpaceMap = new Map<string, string>();
  currentConnectAddrs = [];
  connectAddrUsed = false;
  sdk.conversationManager.conversations = [];
  sdk.channelManager.channelInfocacheMap = {};
}

async function sendSyncResult(hasUnread: boolean, hasAuth: boolean): Promise<void> {
  await browser.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPE.offscreenSyncResult,
    hasUnread,
    hasAuth,
    polledAt: Date.now(),
  } satisfies ExtensionRuntimeMessage);
}

async function sendNewMessage(message: Message, title: string, body: string): Promise<void> {
  await browser.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPE.offscreenNewMessage,
    notificationId: buildNotificationId(
      getConversationTarget(message.channel),
      message.messageID || String(message.messageSeq || Date.now()),
    ),
    title,
    body,
    target: getConversationTarget(message.channel),
    messageKey: message.messageID || String(message.messageSeq || ""),
  } satisfies ExtensionRuntimeMessage);
}

function getAuthOrThrow(): ExtensionAuthState {
  if (!currentAuth?.loggedIn || !currentAuth.token) {
    throw new Error("AUTH_REQUIRED");
  }
  return currentAuth;
}

async function fetchJSON<T>(
  path: string,
  init?: RequestInit,
  authOverride?: ExtensionAuthState,
): Promise<T> {
  const auth = authOverride ?? getAuthOrThrow();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("token", auth.token);

  try {
    return await apiFetchJson<T>(`${normalizeApiURL(auth.apiURL)}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    if (isApiFetchError(error)) {
      const status = error.httpStatus ?? error.response.status;
      if (status === 401) {
        throw new Error("AUTH_EXPIRED");
      }
      throw new Error(`HTTP_${status}`);
    }
    throw error;
  }
}

async function fetchConnectAddrs(auth: ExtensionAuthState): Promise<string[]> {
  const response = await fetchJSON<{ wss_addr?: string; ws_addr?: string }>(
    `users/${encodeURIComponent(auth.uid)}/im`,
    { method: "GET" },
    auth,
  );
  const addr = response.wss_addr || response.ws_addr;
  return addr ? [addr] : [];
}

function cacheSyncEntities(response: SyncConversationsResponse): void {
  for (const user of response.users ?? []) {
    if (!user.uid) {
      continue;
    }
    const channelInfo = Convert.userToChannelInfo(user);
    sdk.channelManager.setChannleInfoForCache(channelInfo);
  }

  for (const group of response.groups ?? []) {
    const channelInfo = Convert.groupToChannelInfo(group);
    sdk.channelManager.setChannleInfoForCache(channelInfo);
    const groupNo = group.group_no || group.channel_id;
    if (!groupNo || !group.space_id) {
      continue;
    }
    channelSpaceMap.set(`${groupNo}_${ChannelTypeGroup}`, String(group.space_id));
  }
}

async function fetchChannelInfo(channel: Channel): Promise<ChannelInfo> {
  const auth = getAuthOrThrow();
  const realChannelId =
    channel.channelType === ChannelTypePerson && channel.channelID.startsWith("s")
      ? channel.channelID.slice(channel.channelID.indexOf("_") + 1)
      : channel.channelID;

  try {
    const data = await fetchJSON<any>(
      `channels/${encodeURIComponent(realChannelId)}/${channel.channelType}`,
      { method: "GET" },
      auth,
    );
    const channelInfo =
      channel.channelType === ChannelTypePerson
        ? Convert.userToChannelInfo({
            ...data.extra,
            ...data,
            uid: data.channel?.channel_id ?? realChannelId,
          })
        : Convert.groupToChannelInfo({
            ...data.extra,
            ...data,
            group_no: data.channel?.channel_id ?? realChannelId,
          });
    channelInfo.channel = new Channel(
      data.channel?.channel_id ?? channel.channelID,
      data.channel?.channel_type ?? channel.channelType,
    );
    sdk.channelManager.setChannleInfoForCache(channelInfo);
    if (channelInfo.orgData?.space_id) {
      channelSpaceMap.set(getChannelKey(channelInfo.channel), String(channelInfo.orgData.space_id));
    }
    return channelInfo;
  } catch (error) {
    const fallback = new ChannelInfo();
    fallback.channel = channel;
    fallback.title = channel.channelID;
    fallback.orgData = {};
    return fallback;
  }
}

async function syncConversations(): Promise<Conversation[]> {
  const auth = getAuthOrThrow();
  const path = auth.currentSpaceId
    ? `conversation/sync?space_id=${encodeURIComponent(auth.currentSpaceId)}`
    : "conversation/sync";
  const response = await fetchJSON<SyncConversationsResponse>(path, {
    method: "POST",
    body: JSON.stringify({ msg_count: 1 }),
  });
  cacheSyncEntities(response);
  return (response.conversations ?? []).map((conversationMap) => {
    if (conversationMap.space_id) {
      channelSpaceMap.set(
        `${conversationMap.channel_id}_${conversationMap.channel_type}`,
        String(conversationMap.space_id),
      );
    }
    return Convert.toConversation(conversationMap);
  });
}

function shouldSkipChannelForSpace(channel: Channel): boolean {
  const currentSpaceId = currentAuth?.currentSpaceId;
  if (!currentSpaceId || !channel?.channelID) {
    return false;
  }

  if (channel.channelID.startsWith("s")) {
    return !channel.channelID.startsWith(`s${currentSpaceId}_`);
  }

  if (channel.channelType === ChannelTypePerson) {
    return false;
  }

  if (channel.channelType === ChannelTypeGroup) {
    const key = getChannelKey(channel);
    const cachedSpaceId = channelSpaceMap.get(key);
    if (cachedSpaceId) {
      return cachedSpaceId !== currentSpaceId;
    }

    const channelInfo = sdk.channelManager.getChannelInfo(channel);
    const infoSpaceId = channelInfo?.orgData?.space_id;
    if (infoSpaceId) {
      channelSpaceMap.set(key, String(infoSpaceId));
      return infoSpaceId !== currentSpaceId;
    }
  }

  return false;
}

function shouldSkipPersonConversationForSpace(conversation: Conversation): boolean {
  const currentSpaceId = currentAuth?.currentSpaceId;
  if (!currentSpaceId || conversation.channel.channelType !== ChannelTypePerson) {
    return false;
  }

  if (SYSTEM_BOTS.has(conversation.channel.channelID)) {
    return false;
  }

  const messageSpaceId = conversation.lastMessage?.content?.contentObj?.space_id;
  return !!messageSpaceId && messageSpaceId !== currentSpaceId;
}

function shouldSkipMessageForSpace(message: Message): boolean {
  if (shouldSkipChannelForSpace(message.channel)) {
    return true;
  }

  const currentSpaceId = currentAuth?.currentSpaceId;
  if (!currentSpaceId || message.channel.channelType !== ChannelTypePerson) {
    return false;
  }

  const messageSpaceId = message.content?.contentObj?.space_id;
  if (messageSpaceId && messageSpaceId !== currentSpaceId) {
    return true;
  }

  if (!messageSpaceId && SYSTEM_BOTS.has(message.channel.channelID)) {
    return true;
  }

  return false;
}

function getBadgeUnread(conversation: Conversation): number {
  const currentSpaceId = currentAuth?.currentSpaceId;
  if (
    currentSpaceId &&
    conversation.channel.channelType === ChannelTypePerson &&
    conversation.extra?.spaceUnread !== undefined
  ) {
    return Math.max(0, Number(conversation.extra.spaceUnread || 0));
  }
  return Math.max(0, Number(conversation.unread || 0));
}

async function updateBadgeFromConversations(): Promise<void> {
  const auth = currentAuth;
  if (!auth?.loggedIn || !auth.token) {
    await sendSyncResult(false, false);
    return;
  }

  let hasUnread = false;
  for (const conversation of sdk.conversationManager.conversations) {
    if (shouldSkipChannelForSpace(conversation.channel)) {
      continue;
    }
    if (shouldSkipPersonConversationForSpace(conversation)) {
      continue;
    }
    const channelInfo = sdk.channelManager.getChannelInfo(conversation.channel);
    if (channelInfo?.mute) {
      continue;
    }
    if (getBadgeUnread(conversation) > 0) {
      hasUnread = true;
      break;
    }
  }

  await sendSyncResult(hasUnread, true);
}

function getMessageBody(message: Message): string {
  const digest =
    message.remoteExtra?.contentEdit?.conversationDigest ||
    message.content?.conversationDigest;
  if (digest && String(digest).trim()) {
    return String(digest).trim();
  }

  const contentObj = message.content?.contentObj;
  if (!contentObj || typeof contentObj !== "object") {
    return "[新消息]";
  }

  if (typeof contentObj.content === "string" && contentObj.content.trim()) {
    return contentObj.content.trim();
  }

  if (typeof contentObj.title === "string" && contentObj.title.trim()) {
    return contentObj.title.trim();
  }

  if (typeof contentObj.name === "string" && contentObj.name.trim()) {
    return `[${contentObj.name.trim()}]`;
  }

  switch (contentObj.type) {
    case 2:
      return "[图片]";
    case 3:
      return "[语音]";
    case 4:
      return "[位置]";
    case 5:
      return "[名片]";
    default:
      return "[新消息]";
  }
}

async function resolveNotificationTitle(message: Message): Promise<string> {
  const existing = sdk.channelManager.getChannelInfo(message.channel);
  if (existing?.orgData?.displayName || existing?.title) {
    return existing.orgData?.displayName || existing.title;
  }

  const channelInfo = await fetchChannelInfo(message.channel);
  return channelInfo.orgData?.displayName || channelInfo.title || message.channel.channelID;
}

async function handleIncomingMessage(message: Message): Promise<void> {
  const auth = currentAuth;
  if (!auth?.loggedIn || !auth.token) {
    return;
  }

  if (message.fromUID === auth.uid) {
    return;
  }

  if (shouldSkipMessageForSpace(message)) {
    return;
  }

  const channelInfo =
    sdk.channelManager.getChannelInfo(message.channel) ??
    (await fetchChannelInfo(message.channel));
  if (channelInfo?.mute) {
    return;
  }

  const title = await resolveNotificationTitle(message);
  const body = getMessageBody(message);
  await sendNewMessage(message, title, body);
}

function handleAuthExpired(): void {
  currentAuth = null;
  sdk.disconnect();
  resetSdkCaches();
  void browser.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPE.authCleared,
  } satisfies ExtensionRuntimeMessage);
  void sendSyncResult(false, false);
}

async function refreshConversations(): Promise<void> {
  if (!currentAuth?.loggedIn || !currentAuth.token) {
    await sendSyncResult(false, false);
    return;
  }

  try {
    await sdk.conversationManager.sync({});
    await updateBadgeFromConversations();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "AUTH_EXPIRED") {
      handleAuthExpired();
      return;
    }
    console.debug("[Extension] Failed to sync conversations in offscreen:", error);
  }
}

function registerListeners(): void {
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;

  // conversationListener 触发时 SDK 的 unread 计数可能还未更新（慢一拍），
  // debounce 300ms 让 SDK 先完成内部状态更新再读取
  let badgeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleBadgeUpdate(): void {
    if (badgeDebounceTimer !== null) {
      clearTimeout(badgeDebounceTimer);
    }
    badgeDebounceTimer = setTimeout(() => {
      badgeDebounceTimer = null;
      void updateBadgeFromConversations();
    }, 300);
  }

  sdk.conversationManager.addConversationListener(() => {
    scheduleBadgeUpdate();
  });

  sdk.channelManager.addListener(() => {
    scheduleBadgeUpdate();
  });

  sdk.chatManager.addMessageListener((message) => {
    // 快速同步检查后立即通知 background 有未读，不等 handleIncomingMessage 的异步网络请求
    const auth = currentAuth;
    if (
      auth?.loggedIn &&
      auth.token &&
      message.fromUID !== auth.uid &&
      !shouldSkipMessageForSpace(message)
    ) {
      void sendSyncResult(true, true);
    }
    void handleIncomingMessage(message);
  });

  sdk.connectManager.addConnectStatusListener((status, reasonCode) => {
    if (status === ConnectStatus.Connected) {
      void refreshConversations();
      return;
    }

    if (status === ConnectStatus.ConnectKick || reasonCode === 2) {
      handleAuthExpired();
      return;
    }

    if (status === ConnectStatus.Disconnect && connectAddrUsed && currentConnectAddrs.length > 1) {
      const first = currentConnectAddrs.shift();
      if (first) {
        currentConnectAddrs.push(first);
      }
      connectAddrUsed = false;
    }
  });

  sdk.config.provider.connectAddrCallback = (callback) => {
    const auth = currentAuth;
    if (!auth?.loggedIn || !auth.token) {
      return;
    }

    void fetchConnectAddrs(auth)
      .then((addrs) => {
        currentConnectAddrs = addrs;
        if (addrs.length > 0) {
          connectAddrUsed = true;
          callback(addrs[0]);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "AUTH_EXPIRED") {
          handleAuthExpired();
          return;
        }
        console.debug("[Extension] Failed to resolve IM connect address:", error);
      });
  };

  sdk.config.provider.channelInfoCallback = (channel) => fetchChannelInfo(channel);
  sdk.config.provider.syncConversationsCallback = () => syncConversations();
}

async function applyAuth(auth: ExtensionAuthState): Promise<void> {
  const sameSession = isSameSession(currentAuth, auth);
  currentAuth = auth;

  sdk.config.uid = auth.uid;
  sdk.config.token = auth.token;

  if (!sameSession) {
    sdk.disconnect();
    resetSdkCaches();
    sdk.connect();
  }

  await refreshConversations();
}

async function clearAuth(): Promise<void> {
  currentAuth = null;
  sdk.disconnect();
  resetSdkCaches();
  await sendSyncResult(false, false);
}

browser.runtime.onMessage.addListener((message: ExtensionRuntimeMessage) => {
  if (message.type === EXTENSION_MESSAGE_TYPE.authChanged) {
    void applyAuth(message.auth);
    return;
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.authCleared) {
    void clearAuth();
  }
});

async function bootstrap(): Promise<void> {
  registerListeners();

  try {
    const response = (await browser.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPE.offscreenReady,
    } satisfies ExtensionRuntimeMessage)) as ExtensionAuthResponse | undefined;

    if (response?.auth?.loggedIn) {
      await applyAuth(response.auth);
      return;
    }
  } catch (error) {
    console.debug("[Extension] Failed to request auth state from background:", error);
  }

  await sendSyncResult(false, false);
}

void bootstrap();
