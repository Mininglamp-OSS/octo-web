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
