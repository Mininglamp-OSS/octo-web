import { describe, it, expect, vi } from 'vitest';

vi.mock('@octo/base', () => ({
    ChannelTypeCommunityTopic: 5,
    parseThreadChannelId: (channelId: string) => {
        const parts = channelId.split('____');
        if (parts.length !== 2) return null;
        return { groupNo: parts[0], shortId: parts[1] };
    },
}));

vi.mock('wukongimjssdk', () => {
    const Channel = class {
        channelID: string;
        channelType: number;
        constructor(id: string, type: number) {
            this.channelID = id;
            this.channelType = type;
        }
    };
    return {
        default: {
            shared: () => ({
                channelManager: {
                    getChannelInfo: (ch: any) => {
                        if (ch.channelID === 'unknown-channel') return null;
                        return { title: `Name of ${ch.channelID}`, orgData: { member_count: 10 } };
                    },
                },
            }),
        },
        Channel,
        ChannelTypeGroup: 2,
        ChannelTypePerson: 1,
    };
});

import { channelToChatCandidate } from '../channelConvert';

describe('channelToChatCandidate', () => {
    it('converts a group channel', () => {
        const result = channelToChatCandidate({ channelID: 'group1', channelType: 2 });
        expect(result).toEqual({
            chat_id: 'group1',
            chat_type: 'group',
            name: 'Name of group1',
            member_count: 10,
        });
    });

    it('converts a person channel to direct', () => {
        const result = channelToChatCandidate({ channelID: 'user1', channelType: 1 });
        expect(result).toEqual({
            chat_id: 'user1',
            chat_type: 'direct',
            name: 'Name of user1',
            member_count: 10,
        });
    });

    it('converts a community topic channel to thread', () => {
        const result = channelToChatCandidate({ channelID: 'topic1', channelType: 5 });
        expect(result).toEqual({
            chat_id: 'topic1',
            chat_type: 'thread',
            name: 'Name of topic1',
            member_count: 10,
        });
    });

    it('detects thread from channelID with ____ separator', () => {
        const result = channelToChatCandidate({ channelID: 'group1____thread1', channelType: 2 });
        expect(result.chat_type).toBe('thread');
    });

    it('falls back to channelID when channelInfo is null', () => {
        const result = channelToChatCandidate({ channelID: 'unknown-channel', channelType: 2 });
        expect(result.name).toBe('unknown-channel');
        expect(result.member_count).toBeNull();
    });

    it('defaults unknown channelType to group', () => {
        const result = channelToChatCandidate({ channelID: 'ch1', channelType: 99 });
        expect(result.chat_type).toBe('group');
    });
});
