import WKSDK, { ChannelTypeGroup, MessageContentType } from "wukongimjssdk";
import type { Conversation } from "wukongimjssdk";
import WKApp from "../App";
import { ChannelTypeCommunityTopic } from "../Service/Const";
import type { PinnedChannelItem } from "../Service/PinnedService";
import { ProhibitwordsService } from "../Service/ProhibitwordsService";
import {
  shouldSkipChannelForSpace,
  shouldSkipPersonConversationForSpace,
} from "../Service/SpaceService";
import { parseThreadChannelId } from "../Service/Thread";
import { getImChannelInfo } from "./channelRuntime";

export function applyPinnedThreadSnapshot(
  conversations: Conversation[],
  pinnedChannels: PinnedChannelItem[] | undefined,
): void {
  if (!pinnedChannels) return;
  const pinnedThreadIds = new Set(
    pinnedChannels
      .filter((item) => item.channel_type === ChannelTypeCommunityTopic)
      .map((item) => item.channel_id),
  );
  for (const conversation of conversations) {
    if (conversation.channel.channelType !== ChannelTypeCommunityTopic) continue;
    conversation.extra = conversation.extra || {};
    conversation.extra.top = pinnedThreadIds.has(conversation.channel.channelID) ? 1 : 0;
  }
}

function prefillSpaceMaps(conversations: Conversation[]): void {
  for (const conversation of conversations) {
    const channel = conversation.channel;
    if (!channel?.channelID) continue;
    const extra = conversation.extra;

    if (channel.channelType === ChannelTypeGroup) {
      const key = `${channel.channelID}_${channel.channelType}`;
      const spaceId = extra?.spaceId
        || conversation.channelInfo?.orgData?.space_id
        || getImChannelInfo(WKSDK.shared(), channel)?.orgData?.space_id;
      if (spaceId && !WKApp.shared.channelSpaceMap.has(key)) {
        WKApp.shared.channelSpaceMap.set(key, spaceId);
      }
      if (extra?.mySourceSpaceId) {
        WKApp.shared.channelMySourceSpaceMap.set(key, extra.mySourceSpaceId);
      }
      continue;
    }

    if (channel.channelType === ChannelTypeCommunityTopic) {
      const parsed = parseThreadChannelId(channel.channelID);
      if (!parsed) continue;
      const parentKey = `${parsed.groupNo}_${ChannelTypeGroup}`;
      const spaceId = extra?.spaceId || conversation.channelInfo?.orgData?.space_id;
      // Threads may fill missing parent mappings, but never replace known ones.
      if (spaceId && !WKApp.shared.channelSpaceMap.has(parentKey)) {
        WKApp.shared.channelSpaceMap.set(parentKey, spaceId);
      }
      if (extra?.mySourceSpaceId && !WKApp.shared.channelMySourceSpaceMap.has(parentKey)) {
        WKApp.shared.channelMySourceSpaceMap.set(parentKey, extra.mySourceSpaceId);
      }
    }
  }
}

/**
 * Prepare accepted, current-scope sync data without mounting a page. The caller
 * owns request freshness and SDK commit; this function does not make sync safe.
 */
export function prepareCurrentImConversationSnapshot(
  conversations: Conversation[] | undefined,
  pinnedChannels: PinnedChannelItem[] | undefined,
  options: { filterTextPreview?: boolean } = {},
): Conversation[] {
  if (!conversations?.length) return [];
  applyPinnedThreadSnapshot(conversations, pinnedChannels);
  prefillSpaceMaps(conversations);

  return conversations.filter((conversation) => {
    if (shouldSkipChannelForSpace(conversation.channel)) return false;
    if (shouldSkipPersonConversationForSpace(conversation)) return false;
    const message = conversation.lastMessage;
    if (options.filterTextPreview && message?.content && message.contentType === MessageContentType.text) {
      message.content.text = ProhibitwordsService.shared.filter(message.content.text);
    }
    return true;
  });
}
