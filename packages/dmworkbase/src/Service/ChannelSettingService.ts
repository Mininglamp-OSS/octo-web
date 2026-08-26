import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
} from "wukongimjssdk";

import APIClient from "./APIClient";
import { ChannelTypeCommunityTopic } from "./Const";
import { hasSpacePrefix, stripSpacePrefix } from "./SpacePrefix";
import { parseThreadChannelId } from "./Thread";
import { apiPath } from './apiPath'

export type ChannelSettingPayload = Record<string, any>;

export interface CreateChannelOptions {
  categoryId?: string;
  name?: string;
  avatarText?: string;
  avatarColor?: number;
  spaceId?: string;
}

export interface UpdateChannelAvatarCustomOptions {
  avatarText?: string;
  avatarColor?: number | "";
  clearUploadedAvatar?: boolean;
}

function isPersonChannel(channel: Channel) {
  return channel.channelType === ChannelTypePerson;
}

export async function updateChannelSetting(
  setting: ChannelSettingPayload,
  channel: Channel
): Promise<void> {
  if (channel.channelType === ChannelTypeGroup) {
    return APIClient.shared.put(apiPath`groups/${channel.channelID}/setting`, setting);
  }

  if (channel.channelType === ChannelTypePerson) {
    return APIClient.shared.put(
      apiPath`users/${stripSpacePrefix(channel.channelID)}/setting`,
      setting
    );
  }

  if (channel.channelType === ChannelTypeCommunityTopic) {
    const threadInfo = parseThreadChannelId(channel.channelID);
    if (!threadInfo) {
      return;
    }
    return APIClient.shared.put(
      apiPath`groups/${threadInfo.groupNo}/threads/${threadInfo.shortId}/setting`,
      setting
    );
  }
}

/**
 * updateChannelSetting 是否会真正发出一次 setting 请求。
 *
 * 该函数对 Group/Person 必发请求;CommunityTopic 仅在 channelID 能解析出 thread 时才发,
 * 解析失败静默 return;其余频道类型直接落空返回 undefined。埋点(conversation_muted /
 * conversation_pinned)必须与"确有请求发出"对齐——否则解析失败/未知类型的静默 no-op 也会
 * 计一次 mute/pin,造成过计数(见 #1452 review P2)。此 helper 复刻上面的分支判定,供调用点前置门控。
 */
export function channelSettingRequestIssued(channel: Channel): boolean {
  if (channel.channelType === ChannelTypeGroup) return true;
  if (channel.channelType === ChannelTypePerson) return true;
  if (channel.channelType === ChannelTypeCommunityTopic) {
    return !!parseThreadChannelId(channel.channelID);
  }
  return false;
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

export function uploadGroupAvatar(groupNo: string, file: File): Promise<void> {
  const data = new FormData();
  data.append("file", file);
  return APIClient.shared.post(`groups/${groupNo}/avatar`, data, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60_000,
  });
}

export async function addChannelSubscribers(
  channel: Channel,
  uids: string[]
): Promise<void> {
  await APIClient.shared.post(apiPath`groups/${channel.channelID}/members`, {
    members: uids,
  });
}

export async function removeChannelSubscribers(
  channel: Channel,
  uids: string[]
): Promise<void> {
  await APIClient.shared.delete(apiPath`groups/${channel.channelID}/members`, {
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
  return APIClient.shared.put(apiPath`groups/${channel.channelID}`, {
    [field]: value,
  });
}

export function updateChannelAvatarCustom(
  channel: Channel,
  options: UpdateChannelAvatarCustomOptions
): Promise<void> {
  if (isPersonChannel(channel)) {
    return Promise.resolve();
  }

  const body: Record<string, any> = {};
  if (typeof options.avatarText === "string") {
    body.avatar_text = options.avatarText;
  }
  if (typeof options.avatarColor === "number" && Number.isInteger(options.avatarColor)) {
    body.avatar_color = String(options.avatarColor);
  } else if (options.avatarColor === "") {
    // 后端约定空串表示清除自定义色（回退按 group_no 派生）。
    body.avatar_color = "";
  }
  if (options.clearUploadedAvatar) {
    body.clear_uploaded_avatar = "1";
  }
  return APIClient.shared.put(`groups/${channel.channelID}`, body);
}

export function transferChannelOwner(
  channel: Channel,
  uid: string
): Promise<void> {
  if (isPersonChannel(channel)) {
    return Promise.resolve();
  }
  return APIClient.shared.post(apiPath`groups/${channel.channelID}/transfer/${uid}`);
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
    apiPath`groups/${channel.channelID}/members/${subscriberUID}`,
    attr
  );
}

export function exitChannel(channel: Channel): Promise<void> {
  if (isPersonChannel(channel)) {
    return Promise.resolve();
  }
  return APIClient.shared.post(apiPath`groups/${channel.channelID}/exit`);
}

export function updateThread(
  groupNo: string,
  shortId: string,
  data: Record<string, any>
): Promise<void> {
  return APIClient.shared.put(apiPath`groups/${groupNo}/threads/${shortId}`, data);
}

export function leaveThread(shortId: string): Promise<void> {
  return APIClient.shared.post(apiPath`threads/${shortId}/leave`);
}
