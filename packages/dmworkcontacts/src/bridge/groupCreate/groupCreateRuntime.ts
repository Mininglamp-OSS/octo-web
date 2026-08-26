import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";

import {
  clearCurrentImChannelSubscribersLocallyRemoved,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
  getCurrentImChannelLocallyRemovedSubscriberUids,
  getCurrentImChannelSubscribers,
  notifyCurrentImSubscriberChangeListeners,
  setCurrentImChannelSubscribersCache,
  SubscriberStatus,
  syncCurrentImChannelSubscribers,
  uploadGroupAvatar as uploadGroupAvatarApi,
  WKApp,
} from "@octo/base";
import { SuperGroup } from "@octo/base/src/Utils/const";

import { buildPrivateChatGroupMemberUids } from "./memberUids";
import type {
  GroupCreateCandidateContact,
  GroupCreateChannelInput,
  GroupCreateContactRecord,
  GroupCreateRuntime,
  GroupCreateSpaceMember,
  GroupCreateSubmitAction,
  GroupCreateSubmitOptions,
} from "./types";

const GROUP_CREATE_SYSTEM_UIDS = ["botfather", "fileHelper"];
const SPACE_MEMBER_PAGE_SIZE = 10000;
const MAX_SPACE_MEMBER_PAGES = 20;

function createDefaultGroupCreateRuntime(): GroupCreateRuntime {
  return {
    addSubscribers(channel, uids) {
      return WKApp.dataSource.channelDataSource.addSubscribers(channel, uids);
    },
    createChannel(uids, options) {
      return WKApp.dataSource.channelDataSource.createChannel(uids, options);
    },
    uploadGroupAvatar(groupNo, file) {
      return uploadGroupAvatarApi(groupNo, file).then(() => {
        WKApp.shared.changeChannelAvatarTag(
          new Channel(groupNo, ChannelTypeGroup)
        );
      });
    },
    getAvatarUser(uid) {
      return WKApp.shared.avatarUser(uid);
    },
    getContactsList() {
      return WKApp.dataSource.contactsList;
    },
    getCurrentChannelInfo(channel) {
      return getCurrentImChannelInfo(channel);
    },
    getCurrentChannelSubscribers(channel) {
      return getCurrentImChannelSubscribers(channel);
    },
    getCurrentSpaceId() {
      return WKApp.shared.currentSpaceId;
    },
    fetchCurrentChannelInfo(channel) {
      return fetchCurrentImChannelInfo(channel);
    },
    fetchChannelSubscriber(channel, uid) {
      return WKApp.dataSource.channelDataSource.subscriber(channel, uid);
    },
    getLoginUid() {
      return WKApp.loginInfo.uid;
    },
    async getSpaceMembers(spaceId, page, limit) {
      const { SpaceService } = await import(
        "@octo/base/src/Service/SpaceService"
      );
      return SpaceService.shared.getMembers(spaceId, page, limit);
    },
    getSuperGroupSubscribers(channel) {
      return WKApp.dataSource.channelDataSource.subscribers(channel, {
        limit: 5000,
        page: 1,
      });
    },
    showConversation(channel, options) {
      WKApp.endpoints.showConversation(channel, options);
    },
    clearRemovedChannelSubscribers(channel, uids) {
      clearCurrentImChannelSubscribersLocallyRemoved(channel, uids);
    },
    getRemovedChannelSubscriberUids(channel) {
      return getCurrentImChannelLocallyRemovedSubscriberUids(channel);
    },
    notifyCurrentChannelSubscribers(channel) {
      notifyCurrentImSubscriberChangeListeners(channel);
    },
    setCurrentChannelSubscribers(channel, subscribers) {
      setCurrentImChannelSubscribersCache(channel, subscribers);
    },
    syncCurrentChannelSubscribers(channel) {
      return syncCurrentImChannelSubscribers(channel);
    },
  };
}

function toUidSet(uids: string[]) {
  return new Set(
    uids.filter((uid) => typeof uid === "string" && uid.length > 0)
  );
}

export async function collectSpaceMembers(
  fetchPage: (page: number, limit: number) => Promise<GroupCreateSpaceMember[]>,
  options: { pageSize?: number; maxPages?: number } = {}
) {
  const pageSize = options.pageSize ?? SPACE_MEMBER_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_SPACE_MEMBER_PAGES;
  const members: GroupCreateSpaceMember[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await fetchPage(page, pageSize);
    if (!batch || batch.length === 0) break;

    members.push(...batch);
    if (batch.length < pageSize) break;
  }

  return members;
}

export function buildGroupCreateCandidateContacts(params: {
  contacts: GroupCreateContactRecord[];
  excludedUids: string[];
  currentUid?: string;
  excludeCurrentUid?: boolean;
  avatarForUid?: (uid: string) => string | undefined;
  systemUids?: string[];
}): GroupCreateCandidateContact[] {
  const excludedUids = toUidSet(params.excludedUids);
  const systemUids = toUidSet(params.systemUids ?? GROUP_CREATE_SYSTEM_UIDS);
  const shouldExcludeCurrentUid = params.excludeCurrentUid && params.currentUid;

  return params.contacts
    .filter((contact) => {
      if (!contact.uid) return false;
      if (excludedUids.has(contact.uid)) return false;
      if (systemUids.has(contact.uid)) return false;
      if (shouldExcludeCurrentUid && contact.uid === params.currentUid) {
        return false;
      }
      return true;
    })
    .map((contact) => ({
      name: contact.name,
      uid: contact.uid,
      avatar: params.avatarForUid?.(contact.uid) ?? contact.avatar,
      robot: contact.robot,
    }));
}

async function loadExcludedSubscriberUids(
  channelInput: GroupCreateChannelInput,
  runtime: GroupCreateRuntime
) {
  if (channelInput.channelID.trim() === "") {
    return [];
  }

  const channel = new Channel(channelInput.channelID, channelInput.channelType);

  if (channelInput.channelType === ChannelTypePerson) {
    return [channelInput.channelID];
  }

  const channelInfo = runtime.getCurrentChannelInfo(channel);
  const subscribers =
    channelInfo?.orgData?.group_type === SuperGroup
      ? await runtime.getSuperGroupSubscribers(channel)
      : await runtime
          .syncCurrentChannelSubscribers(channel)
          .then(() => runtime.getCurrentChannelSubscribers(channel));
  const locallyRemovedUids = new Set(
    runtime.getRemovedChannelSubscriberUids(channel)
  );

  return Array.from(
    new Set(
      (subscribers || [])
        .map((subscriber) => subscriber.uid)
        .filter((uid): uid is string => !!uid && !locallyRemovedUids.has(uid))
    )
  );
}

export async function loadGroupCreateCandidates(params: {
  channel: GroupCreateChannelInput;
  runtime?: GroupCreateRuntime;
}) {
  const runtime = params.runtime ?? createDefaultGroupCreateRuntime();
  const excludedUids = await loadExcludedSubscriberUids(params.channel, runtime);
  const spaceId = runtime.getCurrentSpaceId();

  if (spaceId) {
    try {
      const members = await collectSpaceMembers((page, limit) =>
        runtime.getSpaceMembers(spaceId, page, limit)
      );

      return buildGroupCreateCandidateContacts({
        contacts: members.map((member) => ({
          name: member.name,
          uid: member.uid,
          avatar: member.avatar,
          robot: member.robot === 1,
        })),
        excludedUids,
        currentUid: runtime.getLoginUid(),
        excludeCurrentUid: true,
        systemUids: GROUP_CREATE_SYSTEM_UIDS,
      });
    } catch {
      // Keep the legacy fallback path: if Space members fail, use contactsList.
    }
  }

  return buildGroupCreateCandidateContacts({
    contacts: runtime.getContactsList(),
    excludedUids,
    avatarForUid: runtime.getAvatarUser,
    systemUids: GROUP_CREATE_SYSTEM_UIDS,
  });
}

async function refreshGroupMemberStateAfterMutation(
  runtime: GroupCreateRuntime,
  channel: Channel,
  addedUids: string[]
) {
  let shouldNotifySubscribers = false;

  try {
    await runtime.syncCurrentChannelSubscribers(channel);
    shouldNotifySubscribers = true;
  } catch (err) {
    console.warn("[addMember] syncSubscribes failed", err);
  }

  const cachePatched = await patchSubscriberCacheAfterAdd(
    runtime,
    channel,
    addedUids
  );

  if (cachePatched) {
    shouldNotifySubscribers = true;
  }

  if (shouldNotifySubscribers) {
    runtime.notifyCurrentChannelSubscribers(channel);
  }

  await runtime.fetchCurrentChannelInfo(channel).catch((err) => {
    console.warn("[addMember] fetchChannelInfo failed", err);
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
  subscriber: any | undefined,
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

async function patchSubscriberCacheAfterAdd(
  runtime: GroupCreateRuntime,
  channel: Channel,
  addedUids: string[]
) {
  const targetUids = new Set(addedUids.filter(Boolean));
  if (targetUids.size === 0) {
    return false;
  }

  const currentSubscribers = runtime.getCurrentChannelSubscribers(channel) || [];
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
    .filter(Boolean);

  if (fetchedSubscribers.length === 0) {
    return false;
  }

  const latestSubscribers = runtime.getCurrentChannelSubscribers(channel) || [];
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

export async function submitGroupCreateAction(params: {
  action: GroupCreateSubmitAction;
  channel: GroupCreateChannelInput;
  selectedUids: string[];
  createOptions?: GroupCreateSubmitOptions;
  avatarFile?: File;
  onAvatarUploadFailed?: () => void;
  keepSidebarTab?: boolean;
  runtime?: GroupCreateRuntime;
}) {
  const runtime = params.runtime ?? createDefaultGroupCreateRuntime();

  if (params.action === "createGroup") {
    const result = await runtime.createChannel(
      params.selectedUids,
      params.createOptions
    );
    if (result?.group_no) {
      let avatarUploadFailed = false;
      if (params.avatarFile) {
        try {
          await runtime.uploadGroupAvatar(result.group_no, params.avatarFile);
        } catch {
          avatarUploadFailed = true;
        }
      }
      runtime.showConversation(
        new Channel(result.group_no, ChannelTypeGroup),
        params.keepSidebarTab ? { fromSidebarList: true } : undefined
      );
      if (avatarUploadFailed) {
        params.onAvatarUploadFailed?.();
      }
    }
    return result;
  }

  const channel = new Channel(
    params.channel.channelID,
    params.channel.channelType
  );
  if (params.channel.channelType === ChannelTypePerson) {
    const memberUids = buildPrivateChatGroupMemberUids(
      runtime.getLoginUid(),
      params.channel.channelID,
      params.selectedUids
    );
    const result = await runtime.createChannel(memberUids);
    if (result?.group_no) {
      runtime.showConversation(new Channel(result.group_no, ChannelTypeGroup));
    }
    return result;
  }

  await runtime.addSubscribers(channel, params.selectedUids);
  runtime.clearRemovedChannelSubscribers(channel, params.selectedUids);
  await refreshGroupMemberStateAfterMutation(
    runtime,
    channel,
    params.selectedUids
  );
  return undefined;
}
