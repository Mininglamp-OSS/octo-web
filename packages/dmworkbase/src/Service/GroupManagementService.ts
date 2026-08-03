import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";

import APIClient from "./APIClient";

export interface GroupSubscriberMap {
  uid: string;
  name?: string;
  remark?: string;
  role?: number;
  version?: number;
  is_deleted?: number;
  status?: number;
  bot_admin?: number;
  [key: string]: unknown;
}

export interface GroupSubscriberListParams {
  keyword?: string;
  limit?: number;
  page?: number;
}

export type GroupSubscriberAvatarResolver = (uid: string) => string;

export function toGroupManagementSubscriber(
  memberMap: GroupSubscriberMap,
  avatarUser?: GroupSubscriberAvatarResolver
): Subscriber {
  const member = new Subscriber();
  member.uid = memberMap.uid;
  member.name = memberMap.name;
  member.remark = memberMap.remark;
  member.role = memberMap.role;
  member.version = memberMap.version;
  member.isDeleted = memberMap.is_deleted;
  member.status = memberMap.status;
  member.orgData = memberMap;
  member.orgData.bot_admin = memberMap.bot_admin || 0;
  if (avatarUser) {
    member.avatar = avatarUser(member.uid);
  }
  return member;
}

export async function listGroupManagementSubscribers(params: {
  channel: Channel;
  request: GroupSubscriberListParams;
  avatarUser?: GroupSubscriberAvatarResolver;
}): Promise<Subscriber[]> {
  const resp = await APIClient.shared.get<GroupSubscriberMap[]>(
    `groups/${params.channel.channelID}/members`,
    {
      param: params.request,
    }
  );
  if (!Array.isArray(resp)) {
    return [];
  }
  return resp.map((item) =>
    toGroupManagementSubscriber(item, params.avatarUser)
  );
}

export function addGroupManagementManagers(
  channel: Channel,
  uids: string[]
): Promise<void> {
  return APIClient.shared.post(`groups/${channel.channelID}/managers`, uids);
}

export function removeGroupManagementManagers(
  channel: Channel,
  uids: string[]
): Promise<void> {
  return APIClient.shared.delete(`groups/${channel.channelID}/managers`, {
    data: uids,
  });
}

export function disbandGroupManagement(channel: Channel): Promise<void> {
  if (channel.channelType === ChannelTypePerson) {
    return Promise.resolve();
  }
  return APIClient.shared.delete(`groups/${channel.channelID}/disband`);
}

export function setGroupManagementBotAdmin(
  channel: Channel,
  uid: string
): Promise<void> {
  return APIClient.shared.put(`groups/${channel.channelID}/bot_admin/${uid}`);
}

export function removeGroupManagementBotAdmin(
  channel: Channel,
  uid: string
): Promise<void> {
  return APIClient.shared.delete(`groups/${channel.channelID}/bot_admin/${uid}`);
}
