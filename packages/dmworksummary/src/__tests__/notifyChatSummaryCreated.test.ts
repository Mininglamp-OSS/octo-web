import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmit = vi.fn();
const mockSwitchToMenuById = vi.fn();
const mockOpenSummaryDetail = vi.fn();

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: {
            mittBus: { on: vi.fn(), off: vi.fn(), emit: (...args: any[]) => mockEmit(...args) },
            switchToMenuById: (...args: any[]) => mockSwitchToMenuById(...args),
            openSummaryDetail: (...args: any[]) => mockOpenSummaryDetail(...args),
        },
    };
});

import { notifyChatSummaryCreated } from '../utils/chatSummaryActions';

describe('notifyChatSummaryCreated (chat-context summary create)', () => {
    const channel = { channelID: 'ch1', channelType: 2 };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the chat side summary panel via mittBus without switching the main tab', () => {
        notifyChatSummaryCreated(channel);

        // BUG 1: must NOT force-switch to the 智能总结 main tab
        expect(mockSwitchToMenuById).not.toHaveBeenCalled();
        expect(mockOpenSummaryDetail).not.toHaveBeenCalled();

        // Stays in chat: opens/refreshes the side panel idempotently
        expect(mockEmit).toHaveBeenCalledWith('wk:toggle-summary-panel', {
            channelId: 'ch1',
            channelType: 2,
            summaryPanelView: 'history',
            forceOpen: true,
        });
    });
});
