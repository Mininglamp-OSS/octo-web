import { Channel, ChannelInfo, Subscriber } from "wukongimjssdk";

import WKApp from "../../App";
import { GroupRole } from "../../Service/Const";
import { updateChannelSetting } from "../../Service/ChannelSettingService";
import {
  addGroupManagementManagers as addGroupManagementManagersApi,
  disbandGroupManagement,
  listGroupManagementSubscribers,
  removeGroupManagementBotAdmin as removeGroupManagementBotAdminApi,
  removeGroupManagementManagers,
  setGroupManagementBotAdmin as setGroupManagementBotAdminApi,
} from "../../Service/GroupManagementService";
import {
  addCurrentImChannelInfoListener,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../im-runtime/currentChannelRuntime";
import { syncGroupDisbandState } from "../../Utils/groupDisband";
import { readAllowNoMention } from "./groupManagementAllowNoMention";
import { submitBotAdmins } from "./groupManagementBotAdmins";

export interface GroupManagementMembers {
  managers: Subscriber[];
  botAdmins: Subscriber[];
}

export interface GroupManagementActionRuntime {
  addChannelInfoListener(listener: (channelInfo: ChannelInfo) => void): () => void;
  addManagers(channel: Channel, uids: string[]): Promise<void>;
  disbandGroup(channel: Channel): Promise<void>;
  fetchChannelInfo(channel: Channel): Promise<any>;
  getChannelInfo(channel: Channel): ChannelInfo | undefined;
  listSubscribers(
    channel: Channel,
    params: { limit: number; page: number }
  ): Promise<Subscriber[]>;
  removeBotAdmin(channel: Channel, uid: string): Promise<void>;
  removeManagers(channel: Channel, uids: string[]): Promise<void>;
  setAllowNoMention(allow: boolean, channel: Channel): Promise<void>;
  setBotAdmin(channel: Channel, uid: string): Promise<void>;
  syncDisbandState(channel: Channel): void;
}

function defaultRuntime(): GroupManagementActionRuntime {
  return {
    addChannelInfoListener(listener) {
      return addCurrentImChannelInfoListener(listener);
    },
    addManagers(channel, uids) {
      return addGroupManagementManagersApi(channel, uids);
    },
    disbandGroup(channel) {
      return disbandGroupManagement(channel);
    },
    fetchChannelInfo(channel) {
      return fetchCurrentImChannelInfo(channel);
    },
    getChannelInfo(channel) {
      return getCurrentImChannelInfo(channel);
    },
    listSubscribers(channel, params) {
      return listGroupManagementSubscribers({
        channel,
        request: params,
        avatarUser: (uid) => WKApp.shared.avatarUser(uid),
      });
    },
    removeBotAdmin(channel, uid) {
      return removeGroupManagementBotAdminApi(channel, uid);
    },
    removeManagers(channel, uids) {
      return removeGroupManagementManagers(channel, uids);
    },
    setAllowNoMention(allow, channel) {
      return updateChannelSetting({ allow_no_mention: allow ? 1 : 0 }, channel);
    },
    setBotAdmin(channel, uid) {
      return setGroupManagementBotAdminApi(channel, uid);
    },
    syncDisbandState(channel) {
      syncGroupDisbandState(channel);
    },
  };
}

function runtimeOrDefault(runtime?: GroupManagementActionRuntime) {
  return runtime ?? defaultRuntime();
}

export async function loadGroupManagementMembers(params: {
  channel: Channel;
  pageSize?: number;
  runtime?: GroupManagementActionRuntime;
}): Promise<GroupManagementMembers> {
  const runtime = runtimeOrDefault(params.runtime);
  const pageSize = params.pageSize ?? 50;
  const managers: Subscriber[] = [];
  const botAdmins: Subscriber[] = [];

  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const members = await runtime.listSubscribers(params.channel, {
      limit: pageSize,
      page,
    });
    for (const member of members) {
      if (member.role === GroupRole.owner || member.role === GroupRole.manager) {
        managers.push(member);
      }
      if (member.orgData?.robot === 1 && member.orgData?.bot_admin === 1) {
        botAdmins.push(member);
      }
    }
    hasMore = members.length >= pageSize;
    page++;
  }

  return { managers, botAdmins };
}

export async function addGroupManagementManagers(params: {
  channel: Channel;
  uids: string[];
  runtime?: GroupManagementActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).addManagers(params.channel, params.uids);
}

export async function removeGroupManagementManager(params: {
  channel: Channel;
  uid: string;
  runtime?: GroupManagementActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).removeManagers(params.channel, [
    params.uid,
  ]);
}

export async function removeGroupManagementBotAdmin(params: {
  channel: Channel;
  uid: string;
  runtime?: GroupManagementActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).removeBotAdmin(
    params.channel,
    params.uid
  );
}

export function addGroupManagementBotAdmins(params: {
  channel: Channel;
  uids: string[];
  runtime?: GroupManagementActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  return submitBotAdmins(params.uids, (uid) =>
    runtime.setBotAdmin(params.channel, uid)
  );
}

export async function disbandGroupManagementGroup(params: {
  channel: Channel;
  runtime?: GroupManagementActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).disbandGroup(params.channel);
}

export function syncGroupManagementDisbandState(params: {
  channel: Channel;
  runtime?: GroupManagementActionRuntime;
}) {
  runtimeOrDefault(params.runtime).syncDisbandState(params.channel);
}

export function readGroupManagementAllowNoMention(params: {
  channel: Channel;
  runtime?: GroupManagementActionRuntime;
}) {
  return readAllowNoMention(
    runtimeOrDefault(params.runtime).getChannelInfo(params.channel)?.orgData
  );
}

export function refreshGroupManagementChannelInfo(params: {
  channel: Channel;
  runtime?: GroupManagementActionRuntime;
}) {
  return runtimeOrDefault(params.runtime).fetchChannelInfo(params.channel);
}

export async function setGroupManagementAllowNoMention(params: {
  allow: boolean;
  channel: Channel;
  runtime?: GroupManagementActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.setAllowNoMention(params.allow, params.channel);
  await runtime.fetchChannelInfo(params.channel);
}

export function subscribeGroupManagementChannelInfo(params: {
  channel: Channel;
  onChange: () => void;
  runtime?: GroupManagementActionRuntime;
}) {
  return runtimeOrDefault(params.runtime).addChannelInfoListener(
    (channelInfo: ChannelInfo) => {
      if (channelInfo.channel.isEqual(params.channel)) {
        params.onChange();
      }
    }
  );
}
