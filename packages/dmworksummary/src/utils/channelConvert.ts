import { ChannelTypeCommunityTopic, getImChannelInfo, parseThreadChannelId } from '@octo/base';
import { ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import WKSDK from 'wukongimjssdk';
import { Channel } from 'wukongimjssdk';
import type { ChatCandidate } from '../types/summary';

export function channelToChatCandidate(channel: {
    channelID: string;
    channelType: number;
}): ChatCandidate {
    const ch = new Channel(channel.channelID, channel.channelType);
    const info = getImChannelInfo(WKSDK.shared(), ch);

    let chatType: ChatCandidate['chat_type'];
    if (
        channel.channelType === ChannelTypeCommunityTopic ||
        parseThreadChannelId(channel.channelID)
    ) {
        chatType = 'thread';
    } else if (channel.channelType === ChannelTypeGroup) {
        chatType = 'group';
    } else if (channel.channelType === ChannelTypePerson) {
        chatType = 'direct';
    } else {
        chatType = 'group';
    }

    return {
        chat_id: channel.channelID,
        chat_type: chatType,
        name: info?.title || channel.channelID,
        member_count: (info?.orgData as any)?.member_count ?? null,
    };
}
