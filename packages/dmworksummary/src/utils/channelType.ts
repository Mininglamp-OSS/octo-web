import { ChannelTypeCommunityTopic, parseThreadChannelId } from '@octo/base';
import { ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import { SourceType } from '../types/summary';
import type { SourceTypeValue } from '../types/summary';

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

/**
 * 获取频道的origin_channel_type,用于API调用。
 * 与getSourceType保持同一套映射逻辑,确保两个入口一致。
 * @throws Error 当频道类型不支持时抛出错误,而非静默发送错误值
 */
export function getOriginChannelType(channel: { channelType: number; channelID: string }): number {
    const sourceType = getSourceType(channel);
    if (sourceType === null) {
        throw new Error(`不支持的频道类型: ${channel.channelType}`);
    }
    return sourceType;
}

/**
 * 把 ChatCandidate 的字符串 chat_type 映射成 SourceType 数值(1=群/2=子区/3=私聊),
 * 用于 origin_channel_type 与 sources[].source_type。
 *
 * 与 getOriginChannelType 是同一套数值语义,但入口不同:getOriginChannelType 吃
 * IM 的 numeric channelType(ChatSummaryNewModal 的 channel prop 有),而
 * SummaryCreatePage 只有 selectedChats 的字符串 chat_type,没有 numeric
 * channelType —— 这个 helper 专门收字符串侧,避免两处各写一份内联 map。
 * @throws Error 当 chat_type 不认识时抛出,而非静默发错值。
 */
export function chatTypeToOriginChannelType(chatType: 'group' | 'thread' | 'direct'): SourceTypeValue {
    switch (chatType) {
        case 'group':
            return SourceType.GROUP_CHAT;
        case 'thread':
            return SourceType.THREAD;
        case 'direct':
            return SourceType.DIRECT_MESSAGE;
        default:
            throw new Error(`不支持的 chat_type: ${chatType}`);
    }
}
