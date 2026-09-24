import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  type Message,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic, MessageContentTypeConst } from "../../Service/Const";
import { extractSpaceIdFromPrefix } from "../../Service/SpacePrefix";
import { isEffectivelyMuted, parseThreadChannelId, ThreadStatus } from "../../Service/Thread";
import { getImChannelInfo } from "../../im-runtime/channelRuntime";
import { spaceUnreadStore } from "./store";

function effectiveGroupSpaceId(groupNo: string): string | undefined {
  const fromMemberships = spaceUnreadStore.getGroupSpaceId(groupNo);
  if (fromMemberships) return fromMemberships;

  // Older compatible sync responses already populate this existing map from
  // conversation.my_source_space_id. External groups must use the member's
  // source Space before falling back to the group's home Space.
  const mySourceSpaceId = WKApp.shared.channelMySourceSpaceMap.get(`${groupNo}_${ChannelTypeGroup}`);
  if (mySourceSpaceId) return mySourceSpaceId;

  return getImChannelInfo(WKSDK.shared(), new Channel(groupNo, ChannelTypeGroup))?.orgData?.space_id;
}

export function resolveIncomingMessageSpaceId(message: Message): string | undefined {
  const prefixedSpaceId = extractSpaceIdFromPrefix(message.channel.channelID);
  if (prefixedSpaceId) return prefixedSpaceId;
  if (message.channel.channelType === ChannelTypePerson) {
    // Legacy DMs without an explicit Space cannot be attributed safely.
    const spaceId = message.content?.contentObj?.space_id;
    return typeof spaceId === "string" && spaceId ? spaceId : undefined;
  }
  if (message.channel.channelType === ChannelTypeGroup) {
    return effectiveGroupSpaceId(message.channel.channelID);
  }
  if (message.channel.channelType === ChannelTypeCommunityTopic) {
    const parent = parseThreadChannelId(message.channel.channelID)?.groupNo;
    return parent ? effectiveGroupSpaceId(parent) : undefined;
  }
  return undefined;
}

export function recordIncomingSpaceUnread(message: Message): boolean {
  if (
    message.send ||
    message.fromUID === WKApp.loginInfo.uid ||
    message.header?.noPersist ||
    !message.header?.reddot ||
    message.contentType === MessageContentTypeConst.rtcData
  ) return false;

  const spaceId = resolveIncomingMessageSpaceId(message);
  if (!spaceId || spaceId === WKApp.shared.currentSpaceId) return false;

  const channelInfo = getImChannelInfo(WKSDK.shared(), message.channel);
  const isThread = message.channel.channelType === ChannelTypeCommunityTopic;
  const parentGroupNo = isThread
    ? parseThreadChannelId(message.channel.channelID)?.groupNo
    : undefined;
  const parentChannelInfo = parentGroupNo
    ? getImChannelInfo(WKSDK.shared(), new Channel(parentGroupNo, ChannelTypeGroup))
    : undefined;
  const threadStatus = channelInfo?.orgData?.thread?.status as number | undefined;
  if (isThread && threadStatus !== undefined && threadStatus !== ThreadStatus.Active) return false;
  // Do not fetch metadata from the realtime message hot path. Existing cache
  // entries provide mute state where available; unknown state is skipped and the
  // next authoritative totals snapshot reconciles the neutral badge.
  if ((!isThread && !channelInfo) || (isThread && !parentChannelInfo)) return false;
  if (isEffectivelyMuted({ isThread, channelInfo, parentChannelInfo })) return false;

  const messageId = String(
    message.messageID || message.clientMsgNo || `${message.channel.getChannelKey()}_${message.messageSeq}`,
  );
  return spaceUnreadStore.recordIncoming(spaceId, messageId);
}
