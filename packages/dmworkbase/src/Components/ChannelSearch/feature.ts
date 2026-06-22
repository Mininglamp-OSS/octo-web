import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";

export function supportsChannelSearch(channel?: Channel | null): boolean {
  if (!channel) return false;
  return (
    channel.channelType === ChannelTypeGroup ||
    channel.channelType === ChannelTypePerson ||
    channel.channelType === ChannelTypeCommunityTopic
  );
}

export function isChannelSearchEnabled(channel?: Channel | null): boolean {
  return !!WKApp.remoteConfig.messagesSearchOn && supportsChannelSearch(channel);
}
