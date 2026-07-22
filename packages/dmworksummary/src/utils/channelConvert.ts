import { ChannelTypeCommunityTopic, parseThreadChannelId } from '@octo/base';
import { ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import WKSDK from 'wukongimjssdk';
import { Channel } from 'wukongimjssdk';
import type { ChatCandidate } from '../types/summary';

export function channelToChatCandidate(channel: {
    channelID: string;
    channelType: number;
}): ChatCandidate {
    const ch = new Channel(channel.channelID, channel.channelType);
    const info = WKSDK.shared().channelManager.getChannelInfo(ch);

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
        // ThreadStatus.Archived = 2. The chat-entry modal builds its default
        // candidate from WK channel metadata rather than the summary API, so
        // preserve the archived bit here for the agent access bridge.
        ...(chatType === 'thread' && (info?.orgData as any)?.thread?.status === 2
            ? { is_archived: true }
            : {}),
    };
}
