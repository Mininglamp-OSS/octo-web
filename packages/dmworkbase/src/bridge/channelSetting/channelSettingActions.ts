import { Channel, ChannelInfo, ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import {
  addChannelSubscribers as addChannelSubscribersApi,
  createChannel as createChannelApi,
  exitChannel as exitChannelApi,
  leaveThread as leaveThreadApi,
  removeChannelSubscribers as removeChannelSubscribersApi,
  transferChannelOwner,
  updateChannelField as updateChannelFieldApi,
  updateChannelSetting,
  updateChannelSubscriberAttr,
  updateThread as updateThreadApi,
} from "../../Service/ChannelSettingService";
import {
  ChannelTypeCommunityTopic,
  EndpointID,
  SubscriberStatus,
} from "../../Service/Const";
import {
  clearCurrentImChannelSubscribersLocallyRemoved,
  deleteCurrentImChannelInfo,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
  getPendingCurrentImChannelInfoFetch,
  getCurrentImChannelSubscribers,
  getCurrentImChannelSubscribersCacheRaw,
  markCurrentImChannelSubscribersLocallyRemoved,
  notifyCurrentImChannelInfoListeners,
  notifyCurrentImSubscriberChangeListeners,
  setCurrentImChannelInfoCache,
  setCurrentImChannelSubscribersCache,
  syncCurrentImChannelSubscribers,
} from "../../im-runtime/currentChannelRuntime";
import { patchImChannelInfoOrgData } from "../../im-runtime/channelRuntime";
import {
  findCurrentImConversation,
  removeCurrentImConversation,
} from "../../im-runtime/currentConversationRuntime";

export interface ChannelSettingActionRuntime {
  addSubscribers(channel: Channel, uids: string[]): Promise<void>;
  clearConversationMessages(conversation: any): Promise<void>;
  createChannel(uids: string[]): Promise<{ group_no?: string } | undefined>;
  deleteConversation(channel: Channel): Promise<void>;
  deleteCurrentChannelInfo(channel: Channel): void;
  exitChannel(channel: Channel): Promise<void>;
  fetchCurrentChannelInfo(channel: Channel): Promise<any>;
  fetchChannelSubscriber(
    channel: Channel,
    uid: string
  ): Promise<ChannelSettingSubscriber | undefined>;
  getCurrentChannelSubscribers(channel: Channel): ChannelSettingSubscriber[];
  getCurrentChannelInfo(channel: Channel): ChannelInfo | undefined;
  getPendingChannelInfoFetch(channel: Channel): Promise<unknown> | undefined;
  getCurrentChannelSubscribersRaw(
    channel: Channel
  ): ChannelSettingSubscriber[] | undefined;
  findConversation(channel: Channel): any | undefined;
  getLoginUid(): string | undefined;
  invokeClearChannelMessages(channel: Channel): void;
  leaveThread(shortId: string): Promise<void>;
  muteChannel(channel: Channel, mute: boolean): Promise<void>;
  removeLocalConversationAndCloseIfOpen(channel: Channel): void;
  removeSubscribers(channel: Channel, uids: string[]): Promise<void>;
  remarkChannel(channel: Channel, remark: string): Promise<void>;
  saveChannel(channel: Channel, save: boolean): Promise<void>;
  showConversation(channel: Channel): void;
  clearRemovedChannelSubscribers(channel: Channel, uids: string[]): void;
  markRemovedChannelSubscribers(channel: Channel, uids: string[]): void;
  notifyCurrentChannelSubscribers(channel: Channel): void;
  notifyCurrentChannelInfo(channelInfo: ChannelInfo): void;
  setCurrentChannelInfo(channelInfo: ChannelInfo): void;
  setCurrentChannelSubscribers(
    channel: Channel,
    subscribers: ChannelSettingSubscriber[]
  ): void;
  syncCurrentChannelSubscribers(channel: Channel): Promise<any>;
  topChannel(channel: Channel, top: boolean): Promise<void>;
  transferOwner(channel: Channel, uid: string): Promise<void>;
  updateChannelField(
    channel: Channel,
    field: string,
    value: string
  ): Promise<void>;
  updateSubscriberAttr(
    channel: Channel,
    uid: string,
    attr: Record<string, any>
  ): Promise<void>;
  updateThread(
    groupNo: string,
    shortId: string,
    data: Record<string, any>
  ): Promise<void>;
}

interface ChannelSettingSubscriber {
  uid?: string;
  status?: number;
  isDeleted?: boolean;
  channel?: Channel;
  [key: string]: any;
}

function defaultRuntime(): ChannelSettingActionRuntime {
  return {
    addSubscribers(channel, uids) {
      return addChannelSubscribersApi(channel, uids);
    },
    clearConversationMessages(conversation) {
      return WKApp.conversationProvider.clearConversationMessages(conversation);
    },
    createChannel(uids) {
      return createChannelApi(uids, {
        spaceId: WKApp.shared.currentSpaceId,
      });
    },
    deleteConversation(channel) {
      return WKApp.conversationProvider.deleteConversation(channel);
    },
    deleteCurrentChannelInfo(channel) {
      deleteCurrentImChannelInfo(channel);
    },
    exitChannel(channel) {
      return exitChannelApi(channel);
    },
    fetchCurrentChannelInfo(channel) {
      return fetchCurrentImChannelInfo(channel);
    },
    fetchChannelSubscriber(channel, uid) {
      return WKApp.dataSource.channelDataSource.subscriber(channel, uid);
    },
    getCurrentChannelSubscribers(channel) {
      return getCurrentImChannelSubscribers(channel);
    },
    getCurrentChannelInfo(channel) {
      return getCurrentImChannelInfo<Channel, ChannelInfo>(channel);
    },
    getPendingChannelInfoFetch(channel) {
      return getPendingCurrentImChannelInfoFetch(channel);
    },
    getCurrentChannelSubscribersRaw(channel) {
      return getCurrentImChannelSubscribersCacheRaw(channel);
    },
    findConversation(channel) {
      return findCurrentImConversation(channel);
    },
    getLoginUid() {
      return WKApp.loginInfo.uid;
    },
    invokeClearChannelMessages(channel) {
      WKApp.endpointManager.invoke(EndpointID.clearChannelMessages, channel);
    },
    leaveThread(shortId) {
      return leaveThreadApi(shortId);
    },
    muteChannel(channel, mute) {
      return updateChannelSetting({ mute: mute ? 1 : 0 }, channel);
    },
    removeLocalConversationAndCloseIfOpen(channel) {
      removeCurrentImConversation(channel);
      const isOpen = WKApp.shared.openChannel?.isEqual(channel);
      if (isOpen) {
        WKApp.shared.openChannel = undefined;
        WKApp.routeRight.popToRoot();
      }
      WKApp.shared.notifyListener();
    },
    removeSubscribers(channel, uids) {
      return removeChannelSubscribersApi(channel, uids);
    },
    remarkChannel(channel, remark) {
      return updateChannelSetting({ remark }, channel);
    },
    saveChannel(channel, save) {
      return updateChannelSetting({ save: save ? 1 : 0 }, channel);
    },
    showConversation(channel) {
      WKApp.endpoints.showConversation(channel);
    },
    clearRemovedChannelSubscribers(channel, uids) {
      clearCurrentImChannelSubscribersLocallyRemoved(channel, uids);
    },
    markRemovedChannelSubscribers(channel, uids) {
      markCurrentImChannelSubscribersLocallyRemoved(channel, uids);
    },
    notifyCurrentChannelSubscribers(channel) {
      notifyCurrentImSubscriberChangeListeners(channel);
    },
    notifyCurrentChannelInfo(channelInfo) {
      notifyCurrentImChannelInfoListeners(channelInfo);
    },
    setCurrentChannelSubscribers(channel, subscribers) {
      setCurrentImChannelSubscribersCache(channel, subscribers);
    },
    setCurrentChannelInfo(channelInfo) {
      setCurrentImChannelInfoCache(channelInfo);
    },
    syncCurrentChannelSubscribers(channel) {
      return syncCurrentImChannelSubscribers(channel);
    },
    topChannel(channel, top) {
      return updateChannelSetting({ top: top ? 1 : 0 }, channel);
    },
    transferOwner(channel, uid) {
      return transferChannelOwner(channel, uid);
    },
    updateChannelField(channel, field, value) {
      return updateChannelFieldApi(channel, field, value);
    },
    updateSubscriberAttr(channel, uid, attr) {
      return updateChannelSubscriberAttr(channel, uid, attr);
    },
    updateThread(groupNo, shortId, data) {
      return updateThreadApi(groupNo, shortId, data);
    },
  };
}

const threadMuteCacheSyncVersions = new Map<string, number>();

function patchThreadMuteCache(
  runtime: ChannelSettingActionRuntime,
  channel: Channel,
  mute: boolean
) {
  const channelInfo = runtime.getCurrentChannelInfo(channel);
  if (!channelInfo) return;

  channelInfo.mute = mute;
  patchImChannelInfoOrgData(channelInfo, {
    thread: {
      ...(channelInfo.orgData?.thread || {}),
      mute: mute ? 1 : 0,
    },
  });
  runtime.setCurrentChannelInfo(channelInfo);
  runtime.notifyCurrentChannelInfo(channelInfo);
}

function syncThreadMuteCacheAfterSave(
  runtime: ChannelSettingActionRuntime,
  channel: Channel,
  mute: boolean
) {
  const channelKey = channel.getChannelKey();
  const version = (threadMuteCacheSyncVersions.get(channelKey) || 0) + 1;
  threadMuteCacheSyncVersions.set(channelKey, version);

  const pendingFetch = runtime.getPendingChannelInfoFetch(channel);
  patchThreadMuteCache(runtime, channel, mute);

  if (!pendingFetch) {
    if (threadMuteCacheSyncVersions.get(channelKey) === version) {
      threadMuteCacheSyncVersions.delete(channelKey);
    }
    return;
  }

  void pendingFetch
    .catch(() => undefined)
    .then(() => {
      if (threadMuteCacheSyncVersions.get(channelKey) !== version) return;
      patchThreadMuteCache(runtime, channel, mute);
      threadMuteCacheSyncVersions.delete(channelKey);
    });
}

async function refreshChannelStateAfterMemberMutation(
  runtime: ChannelSettingActionRuntime,
  channel: Channel,
  action: "addSubscribers" | "removeSubscribers",
  uids: string[]
) {
  let shouldNotifySubscribers = false;
  let notifiedLocalRemoval = false;

  if (action === "removeSubscribers") {
    const cachePatchedBeforeSync =
      await patchSubscriberCacheAfterMemberMutation(
        runtime,
        channel,
        action,
        uids
      );
    if (cachePatchedBeforeSync) {
      runtime.notifyCurrentChannelSubscribers(channel);
      notifiedLocalRemoval = true;
    }
    runtime.markRemovedChannelSubscribers(channel, uids);
  }

  try {
    await runtime.syncCurrentChannelSubscribers(channel);
    shouldNotifySubscribers = true;
  } catch (err) {
    console.warn(`[${action}] syncSubscribes failed`, err);
  }

  const cachePatched = await patchSubscriberCacheAfterMemberMutation(
    runtime,
    channel,
    action,
    uids
  );

  if (cachePatched) {
    shouldNotifySubscribers = true;
  }

  if (shouldNotifySubscribers && (!notifiedLocalRemoval || cachePatched)) {
    runtime.notifyCurrentChannelSubscribers(channel);
  }

  await runtime.fetchCurrentChannelInfo(channel).catch((err) => {
    console.warn(`[${action}] fetchChannelInfo failed`, err);
  });
}

function activeSubscriber(subscriber: any) {
  return (
    subscriber &&
    !subscriber.isDeleted &&
    subscriber.status === SubscriberStatus.normal
  );
}

function normalizeFetchedSubscriber(
  subscriber: ChannelSettingSubscriber | undefined,
  channel: Channel
) {
  if (!subscriber || subscriber.isDeleted) {
    return undefined;
  }
  if (subscriber.status === undefined) {
    subscriber.status = SubscriberStatus.normal;
  }
  if (subscriber.status !== SubscriberStatus.normal) {
    return undefined;
  }
  subscriber.channel = channel;
  return subscriber;
}

async function patchSubscriberCacheAfterMemberMutation(
  runtime: ChannelSettingActionRuntime,
  channel: Channel,
  action: "addSubscribers" | "removeSubscribers",
  uids: string[]
) {
  const targetUids = new Set(uids.filter(Boolean));
  if (targetUids.size === 0) {
    return false;
  }

  const currentSubscribers =
    runtime.getCurrentChannelSubscribersRaw(channel) ||
    runtime.getCurrentChannelSubscribers(channel) ||
    [];

  if (action === "removeSubscribers") {
    const nextSubscribers = currentSubscribers.filter(
      (subscriber) => !targetUids.has(subscriber?.uid ?? "")
    );
    if (nextSubscribers.length !== currentSubscribers.length) {
      runtime.setCurrentChannelSubscribers(channel, nextSubscribers);
      return true;
    }
    return false;
  }

  const uidsToFetch = Array.from(targetUids).filter((uid) => {
    const index = currentSubscribers.findIndex(
      (subscriber) => subscriber?.uid === uid
    );
    return index < 0 || !activeSubscriber(currentSubscribers[index]);
  });

  const fetchedSubscribers = (
    await Promise.all(
      uidsToFetch.map((uid) =>
        runtime.fetchChannelSubscriber(channel, uid).catch(() => undefined)
      )
    )
  )
    .map((subscriber) => normalizeFetchedSubscriber(subscriber, channel))
    .filter(Boolean) as ChannelSettingSubscriber[];

  if (fetchedSubscribers.length === 0) {
    return false;
  }

  const latestSubscribers =
    runtime.getCurrentChannelSubscribersRaw(channel) ||
    runtime.getCurrentChannelSubscribers(channel) ||
    [];
  const nextSubscribers = [...latestSubscribers];
  let changed = false;

  for (const subscriber of fetchedSubscribers) {
    const index = nextSubscribers.findIndex(
      (item) => item?.uid === subscriber.uid
    );
    if (index >= 0 && activeSubscriber(nextSubscribers[index])) {
      continue;
    }
    if (index >= 0) {
      nextSubscribers[index] = subscriber;
    } else {
      nextSubscribers.push(subscriber);
    }
    changed = true;
  }

  if (changed) {
    runtime.setCurrentChannelSubscribers(channel, nextSubscribers);
  }
  return changed;
}

function runtimeOrDefault(runtime?: ChannelSettingActionRuntime) {
  return runtime ?? defaultRuntime();
}

export async function addChannelSettingSubscribers(params: {
  channel: Channel;
  uids: string[];
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.addSubscribers(params.channel, params.uids);
  runtime.clearRemovedChannelSubscribers(params.channel, params.uids);
  await refreshChannelStateAfterMemberMutation(
    runtime,
    params.channel,
    "addSubscribers",
    params.uids
  );
}

export async function createGroupFromChannelSettingPrivateChat(params: {
  channel: Channel;
  selectedUids: string[];
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  const result = await runtime.createChannel([
    runtime.getLoginUid() || "",
    params.channel.channelID,
    ...params.selectedUids,
  ]);
  if (result?.group_no) {
    runtime.showConversation(new Channel(result.group_no, ChannelTypeGroup));
  }
  return result;
}

export async function removeChannelSettingSubscribers(params: {
  channel: Channel;
  uids: string[];
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.removeSubscribers(params.channel, params.uids);
  await refreshChannelStateAfterMemberMutation(
    runtime,
    params.channel,
    "removeSubscribers",
    params.uids
  );
}

export async function updateChannelSettingField(params: {
  channel: Channel;
  field: string;
  value: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).updateChannelField(
    params.channel,
    params.field,
    params.value
  );
}

export async function muteChannelSetting(params: {
  channel: Channel;
  mute: boolean;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.muteChannel(params.channel, params.mute);
  if (params.channel.channelType === ChannelTypeCommunityTopic) {
    syncThreadMuteCacheAfterSave(runtime, params.channel, params.mute);
  }
}

export async function topChannelSetting(params: {
  channel: Channel;
  top: boolean;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).topChannel(params.channel, params.top);
}

export async function saveChannelSetting(params: {
  channel: Channel;
  save: boolean;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).saveChannel(
    params.channel,
    params.save
  );
}

export async function remarkChannelSetting(params: {
  channel: Channel;
  remark: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).remarkChannel(
    params.channel,
    params.remark
  );
}

export async function transferChannelSettingOwner(params: {
  channel: Channel;
  uid: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.transferOwner(params.channel, params.uid);
  void runtime.syncCurrentChannelSubscribers(params.channel);
  void runtime.fetchCurrentChannelInfo(params.channel);
}

export async function updateChannelSettingMyGroupNickname(params: {
  channel: Channel;
  remark: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.updateSubscriberAttr(
    params.channel,
    runtime.getLoginUid() || "",
    { remark: params.remark }
  );
}

export async function clearChannelSettingMessages(params: {
  channel: Channel;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  const conversation = runtime.findConversation(params.channel);
  if (!conversation) {
    return;
  }
  await runtime.clearConversationMessages(conversation);
  conversation.lastMessage = undefined;
  runtime.invokeClearChannelMessages(params.channel);
}

export async function exitChannelSettingGroup(params: {
  channel: Channel;
  onDeleteConversationError?: (err: any) => void;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.exitChannel(params.channel);
  await runtime.deleteConversation(params.channel).catch((err) => {
    params.onDeleteConversationError?.(err);
  });
  runtime.removeLocalConversationAndCloseIfOpen(params.channel);
}

export async function updateChannelSettingThreadName(params: {
  channel: Channel;
  groupNo: string;
  shortId: string;
  name: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.updateThread(params.groupNo, params.shortId, {
    name: params.name,
  });
  runtime.deleteCurrentChannelInfo(params.channel);
  await runtime.fetchCurrentChannelInfo(params.channel);
}

export async function leaveChannelSettingThread(params: {
  channel: Channel;
  shortId: string;
  onDeleteConversationError?: (err: any) => void;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.leaveThread(params.shortId);
  await runtime.deleteConversation(params.channel).catch((err) => {
    params.onDeleteConversationError?.(err);
  });
  runtime.removeLocalConversationAndCloseIfOpen(params.channel);
}
