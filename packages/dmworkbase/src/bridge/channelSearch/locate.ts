import { Channel } from "wukongimjssdk";
import type { ChannelSearchItem } from "../../Service/SearchTypes";

export function canLocateChannelSearchItem(item: ChannelSearchItem) {
  return Number.isFinite(item.messageSeq) && item.messageSeq > 0;
}

export function resolveChannelSearchLocateTarget(
  item: ChannelSearchItem,
  currentChannel: Channel
) {
  if (!canLocateChannelSearchItem(item)) {
    return undefined;
  }

  const targetChannel = new Channel(
    item.channelId || currentChannel.channelID,
    item.channelType ?? currentChannel.channelType
  );
  return {
    channel: targetChannel,
    isCurrentChannel:
      targetChannel.channelID === currentChannel.channelID &&
      targetChannel.channelType === currentChannel.channelType,
    messageSeq: item.messageSeq,
  };
}
