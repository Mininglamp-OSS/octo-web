import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";

import {
  getCurrentImChannelInfo,
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
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

  return Array.from(
    new Set((subscribers || []).map((subscriber) => subscriber.uid))
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

export async function submitGroupCreateAction(params: {
  action: GroupCreateSubmitAction;
  channel: GroupCreateChannelInput;
  selectedUids: string[];
  createOptions?: GroupCreateSubmitOptions;
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
      runtime.showConversation(
        new Channel(result.group_no, ChannelTypeGroup),
        params.keepSidebarTab ? { fromSidebarList: true } : undefined
      );
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
  return undefined;
}
