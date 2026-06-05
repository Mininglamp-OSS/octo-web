import { describe, it, expect, vi } from 'vitest';

vi.mock('@octo/base', () => ({
    ChannelTypeCommunityTopic: 5,
    parseThreadChannelId: (channelId: string) => {
        const parts = channelId.split('____');
        if (parts.length !== 2) return null;
        return { groupNo: parts[0], shortId: parts[1] };
    },
    WKApp: {
        loginInfo: { token: 'test-token', uid: 'test-uid' },
        shared: { currentSpaceId: 'space-123', logout: () => {} },
    },
}));

vi.mock('wukongimjssdk', () => ({
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
}));

import { isSupportedChannelType, getSourceType } from '../channelType';

describe('channelType utils', () => {
    describe('isSupportedChannelType', () => {
        it('returns true for channelType 1 (Person)', () => {
            expect(isSupportedChannelType({ channelType: 1 })).toBe(true);
        });

        it('returns true for channelType 2 (Group)', () => {
            expect(isSupportedChannelType({ channelType: 2 })).toBe(true);
        });

        it('returns true for channelType 5 (CommunityTopic)', () => {
            expect(isSupportedChannelType({ channelType: 5 })).toBe(true);
        });

        it('returns false for channelType 3 (CustomerService)', () => {
            expect(isSupportedChannelType({ channelType: 3 })).toBe(false);
        });

        it('returns false for channelType 4', () => {
            expect(isSupportedChannelType({ channelType: 4 })).toBe(false);
        });

        it('returns false for channelType 99', () => {
            expect(isSupportedChannelType({ channelType: 99 })).toBe(false);
        });
    });

    describe('getSourceType', () => {
        it('maps channelType=2 (Group) to GROUP_CHAT (1)', () => {
            expect(getSourceType({ channelType: 2, channelID: 'group123' })).toBe(1);
        });

        it('maps channelType=1 (Person) to DIRECT_MESSAGE (3)', () => {
            expect(getSourceType({ channelType: 1, channelID: 'user456' })).toBe(3);
        });

        it('maps channelType=5 (CommunityTopic) to THREAD (2)', () => {
            expect(getSourceType({ channelType: 5, channelID: 'topic789' })).toBe(2);
        });

        it('maps channelID with ____ separator to THREAD (2) regardless of channelType', () => {
            expect(getSourceType({ channelType: 2, channelID: 'group1____thread1' })).toBe(2);
        });

        it('returns null for unsupported channelType 99', () => {
            expect(getSourceType({ channelType: 99, channelID: 'unknown' })).toBeNull();
        });
    });
});
