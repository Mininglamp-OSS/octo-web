import { useState, useEffect, useRef } from 'react';
import { WKApp } from '@octo/base';
import { Channel, Subscriber } from 'wukongimjssdk';
import { isBot } from '@octo/base/src/Components/WKAvatar';
import type { AssigneeInfo } from './useMemberList';

export interface ChannelRef {
    channelId: string;
    channelType: number;
}

interface UseMembersFromChannelsOptions {
    /** 为 false 时不发起拉取, 用于延迟加载场景（例如下拉没打开时） */
    enabled?: boolean;
    /** 每个 channel 拉取的成员上限 */
    limitPerChannel?: number;
}

interface UseMembersFromChannelsResult {
    members: AssigneeInfo[];
    loading: boolean;
}

const DEFAULT_LIMIT = 100;

/**
 * useMembersFromChannels — 并发拉多个 channel 的成员并合并去重。
 *
 * 使用场景 (PRD §5.1 关联 channel 成员 = Matter access 主体):
 *   选负责人时候选人应该是"Matter 关联的所有 channel 成员的并集", 而非仅发起
 *   channel。一个 Matter 可能关联多群 (发起群 + 后来关联的群), 成员都是潜在
 *   负责人候选。
 *
 * 去重策略: 按 uid 去重, 先到先得 (保留第一次出现时的 name/avatar)。
 *
 * 跟 useMemberList 的区别:
 *   - useMemberList: 单 channel, 支持分页 / keyword 搜索
 *   - useMembersFromChannels: 多 channel, 一次拉取前 N 个, 合并去重, 不做搜索
 *     (下拉候选体量小, 用户如果需要搜索, 后续可以在组件层加本地 filter)
 */
export function useMembersFromChannels(
    channels: ChannelRef[],
    options: UseMembersFromChannelsOptions = {},
): UseMembersFromChannelsResult {
    const { enabled = true, limitPerChannel = DEFAULT_LIMIT } = options;

    const [members, setMembers] = useState<AssigneeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    // requestId 丢弃过期结果 (channel 列表变化 / unmount 时)
    const requestIdRef = useRef(0);

    // 序列化 channel 列表作为依赖 key, 避免父组件每次传新数组引用导致无限循环
    const channelsKey = channels.map((c) => `${c.channelId}:${c.channelType}`).sort().join('|');

    useEffect(() => {
        if (!enabled || channels.length === 0) {
            setMembers([]);
            return;
        }

        const reqId = ++requestIdRef.current;
        setLoading(true);

        Promise.all(
            channels.map((ref) => {
                const ch = new Channel(ref.channelId, ref.channelType);
                return WKApp.dataSource.channelDataSource
                    .subscribers(ch, { page: 1, limit: limitPerChannel, keyword: '' })
                    .then((subs: Subscriber[] | undefined) => subs ?? [])
                    .catch((err: unknown) => {
                        // 单个 channel 失败不阻断整个并发, 但不静默吞掉异常。
                        // 下拉候选体量小, 日志量可控, 直接 warn 方便排查。
                        console.warn(
                            '[useMembersFromChannels] subscribers failed',
                            ref.channelId,
                            err,
                        );
                        return [] as Subscriber[];
                    });
            }),
        ).then((allBatches) => {
            if (reqId !== requestIdRef.current) return;

            const seen = new Set<string>();
            const merged: AssigneeInfo[] = [];
            for (const batch of allBatches) {
                for (const s of batch) {
                    if (seen.has(s.uid)) continue;
                    seen.add(s.uid);
                    merged.push({
                        uid: s.uid,
                        name: s.remark || s.name || s.uid,
                        avatar: WKApp.shared.avatarUser(s.uid),
                        isBot: isBot(s.uid),
                    });
                }
            }
            setMembers(merged);
            setLoading(false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelsKey, enabled, limitPerChannel]);

    return { members, loading };
}
