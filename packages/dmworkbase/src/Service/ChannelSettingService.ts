import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
} from "wukongimjssdk";

import APIClient from "./APIClient";
import { ChannelTypeCommunityTopic } from "./Const";
import { hasSpacePrefix } from "./SpacePrefix";
import { parseThreadChannelId } from "./Thread";

export type ChannelSettingPayload = Record<string, any>;

export interface CreateChannelOptions {
  categoryId?: string;
  name?: string;
  avatarText?: string;
  avatarColor?: number;
  spaceId?: string;
}

function stripSpacePrefix(uid: string) {
  if (!hasSpacePrefix(uid)) {
    return uid;
  }
  return uid.substring(uid.indexOf("_") + 1);
}

function isPersonChannel(channel: Channel) {
  return channel.channelType === ChannelTypePerson;
}

export async function updateChannelSetting(
  setting: ChannelSettingPayload,
  channel: Channel
): Promise<void> {
  if (channel.channelType === ChannelTypeGroup) {
    return APIClient.shared.put(`groups/${channel.channelID}/setting`, setting);
  }

  if (channel.channelType === ChannelTypePerson) {
    return APIClient.shared.put(
      `users/${stripSpacePrefix(channel.channelID)}/setting`,
      setting
    );
  }

  if (channel.channelType === ChannelTypeCommunityTopic) {
    const threadInfo = parseThreadChannelId(channel.channelID);
    if (!threadInfo) {
      return;
    }
    return APIClient.shared.put(
      `groups/${threadInfo.groupNo}/threads/${threadInfo.shortId}/setting`,
      setting
    );
  }
}

export function createChannel(
  uids: string[],
  options?: CreateChannelOptions
): Promise<{ group_no?: string } | undefined> {
  const body: Record<string, any> = { members: uids };
  if (options?.spaceId) {
    body.space_id = options.spaceId;
  }
  if (options?.categoryId) {
    body.category_id = options.categoryId;
  }
  if (options?.name) {
    body.name = options.name;
  }
  if (options?.avatarText) {
    body.avatar_text = options.avatarText;
  }
  if (typeof options?.avatarColor === "number" && options.avatarColor >= 0) {
    body.avatar_color = options.avatarColor;
  }
  return APIClient.shared.post("group/create", body);
}

export async function addChannelSubscribers(
  channel: Channel,
  uids: string[]
): Promise<void> {
  await APIClient.shared.post(`groups/${channel.channelID}/members`, {
    members: uids,
  });
}

export async function removeChannelSubscribers(
  channel: Channel,
  uids: string[]
): Promise<void> {
  await APIClient.shared.delete(`groups/${channel.channelID}/members`, {
    data: {
      members: uids,
    },
  });
}

export function updateChannelField(
  channel: Channel,
  field: string,
  value: string
): Promise<void> {
  return APIClient.shared.put(`groups/${channel.channelID}`, {
    [field]: value,
  });
}

export function transferChannelOwner(
  channel: Channel,
  uid: string
): Promise<void> {
  if (isPersonChannel(channel)) {
    return Promise.resolve();
  }
  return APIClient.shared.post(`groups/${channel.channelID}/transfer/${uid}`);
}

export function updateChannelSubscriberAttr(
  channel: Channel,
  subscriberUID: string,
  attr: Record<string, any>
): Promise<any> {
  if (isPersonChannel(channel)) {
    return Promise.resolve();
  }
  return APIClient.shared.put(
    `groups/${channel.channelID}/members/${subscriberUID}`,
    attr
  );
}

export function exitChannel(channel: Channel): Promise<void> {
  if (isPersonChannel(channel)) {
    return Promise.resolve();
  }
  return APIClient.shared.post(`groups/${channel.channelID}/exit`);
}

export function updateThread(
  groupNo: string,
  shortId: string,
  data: Record<string, any>
): Promise<void> {
  return APIClient.shared.put(`groups/${groupNo}/threads/${shortId}`, data);
}

export function leaveThread(shortId: string): Promise<void> {
  return APIClient.shared.post(`threads/${shortId}/leave`);
}
