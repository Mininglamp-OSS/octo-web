import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn().mockResolvedValue(undefined);

vi.mock('wukongimjssdk', () => ({
    Channel: class {
        channelID: string;
        channelType: number;
        constructor(id: string, type: number) {
            this.channelID = id;
            this.channelType = type;
        }
    },
    ChannelTypeGroup: 2,
    WKSDK: {
        shared: () => ({
            chatManager: { send: mockSend },
        }),
    },
}));

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        ChannelTypeCommunityTopic: 5,
        SummaryNotifyContent: class {
            fromUID = '';
            fromName = '';
            get contentType() { return 21; }
            encodeJSON() {
                return { type: 21, from_uid: this.fromUID, from_name: this.fromName };
            }
        },
        WKApp: {
            ...(actual as any).WKApp,
            loginInfo: { uid: 'user_001', name: 'Test User', token: 'test-token' },
        },
    };
});

import { sendSummaryNotifyTip } from '../sendSummaryNotifyTip';

describe('sendSummaryNotifyTip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sends tip to group sources', async () => {
        await sendSummaryNotifyTip([
            { source_type: 1, source_id: 'group_abc' },
        ]);

        expect(mockSend).toHaveBeenCalledTimes(1);
        const [msg, channel] = mockSend.mock.calls[0];
        expect(msg.fromUID).toBe('user_001');
        expect(msg.fromName).toBe('Test User');
        expect(channel.channelID).toBe('group_abc');
        expect(channel.channelType).toBe(2); // ChannelTypeGroup
    });

    it('sends tip to thread sources', async () => {
        await sendSummaryNotifyTip([
            { source_type: 2, source_id: 'group_abc____thread_123' },
        ]);

        expect(mockSend).toHaveBeenCalledTimes(1);
        const [, channel] = mockSend.mock.calls[0];
        expect(channel.channelID).toBe('group_abc____thread_123');
        expect(channel.channelType).toBe(5); // ChannelTypeCommunityTopic
    });

    it('skips DM sources', async () => {
        await sendSummaryNotifyTip([
            { source_type: 3, source_id: 'user_xyz' },
        ]);

        expect(mockSend).not.toHaveBeenCalled();
    });

    it('handles multiple sources', async () => {
        await sendSummaryNotifyTip([
            { source_type: 1, source_id: 'group_1' },
            { source_type: 1, source_id: 'group_2' },
            { source_type: 3, source_id: 'dm_skip' },
            { source_type: 2, source_id: 'group_3____thread_1' },
        ]);

        expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('does nothing for empty sources', async () => {
        await sendSummaryNotifyTip([]);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('silently ignores send errors', async () => {
        mockSend.mockRejectedValueOnce(new Error('network error'));

        await expect(
            sendSummaryNotifyTip([{ source_type: 1, source_id: 'group_abc' }])
        ).resolves.toBeUndefined();
    });
});
