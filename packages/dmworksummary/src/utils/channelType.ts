import { ChannelTypeCommunityTopic, parseThreadChannelId } from '@octo/base';
import { ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import { SourceType } from '../types/summary';

export function isSupportedChannelType(channel: { channelType: number }): boolean {
    return channel.channelType === ChannelTypePerson
        || channel.channelType === ChannelTypeGroup
        || channel.channelType === ChannelTypeCommunityTopic;
}

export function getSourceType(channel: { channelType: number; channelID: string }): number | null {
    if (channel.channelType === ChannelTypeCommunityTopic || parseThreadChannelId(channel.channelID)) {
        return SourceType.THREAD;
    }
    if (channel.channelType === ChannelTypeGroup) {
        return SourceType.GROUP_CHAT;
    }
    if (channel.channelType === ChannelTypePerson) {
        return SourceType.DIRECT_MESSAGE;
    }
    return null;
}
