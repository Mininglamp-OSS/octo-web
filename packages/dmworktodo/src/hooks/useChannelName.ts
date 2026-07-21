import { useState, useEffect } from 'react';
import {
    addImChannelInfoListener,
    fetchImChannelInfo,
    getImChannelInfo,
} from '@octo/base';
import WKSDK, { Channel } from 'wukongimjssdk';
import type { ChannelInfo } from 'wukongimjssdk';

/**
 * Resolve a (channelId, channelType) to a display name via WKSDK channel info.
 *
 * 使用场景: 历史数据里 Matter.source_name 为 NULL 时, 拿 source_channel_id
 * 反查群名, 不再显示空白。跟 useUserName 同构, 只是 channelType 不再写死为 Person。
 *
 * Returns:
 *   - 命中缓存: 直接返回 title
 *   - 未命中: 触发异步 fetch, 同时订阅 channelInfo listener, 拿到后重渲染
 *   - fetch 失败 / channelId 为空: fallback 返回空串 (调用方可以加 "未知群聊" 兜底)
 */
export function useChannelName(
    channelId: string | undefined | null,
    channelType: number | undefined | null,
): string {
    const [name, setName] = useState<string>(() => {
        if (!channelId || !channelType) return '';
        const info = getImChannelInfo(
            WKSDK.shared(),
            new Channel(channelId, channelType),
        );
        return info?.title || '';
    });

    useEffect(() => {
        if (!channelId || !channelType) {
            setName('');
            return;
        }
        let aborted = false;

        const channel = new Channel(channelId, channelType);
        const sdk = WKSDK.shared();
        const cached = getImChannelInfo(sdk, channel);
        if (cached?.title) {
            setName(cached.title);
        }

        // 无论缓存是否命中都注册 listener, 确保群改名后 UI 能实时更新
        const listener = (channelInfo: ChannelInfo) => {
            if (
                !aborted &&
                channelInfo.channel.channelID === channelId &&
                channelInfo.channel.channelType === channelType
            ) {
                setName(channelInfo.title || '');
            }
        };

        const unsubscribe = addImChannelInfoListener(sdk, listener);

        // 缓存未命中时触发异步 fetch
        if (!cached?.title) {
            fetchImChannelInfo(sdk, channel).catch(() => {
                // fetch 失败不 fallback 到 channelId; 调用方视觉上 "#{xxx...}" 不友好,
                // 保持空串让上层决定显示 "未知群聊" 或隐藏整块
            });
        }

        return () => {
            aborted = true;
            unsubscribe();
        };
    }, [channelId, channelType]);

    return name;
}
