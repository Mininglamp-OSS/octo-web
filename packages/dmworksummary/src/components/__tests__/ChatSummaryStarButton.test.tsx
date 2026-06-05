import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSummaryStarButton from '../ChatSummaryStarButton';

const mockEmit = vi.fn();

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: { mittBus: { emit: (...args: any[]) => mockEmit(...args) } },
    };
});

const mockListSummaries = vi.fn();

vi.mock('../../api/summaryApi', () => ({
    listSummaries: (...args: any[]) => mockListSummaries(...args),
}));

vi.mock('lucide-react', () => ({
    Sparkle: (props: any) => (
        <svg data-testid="sparkle-icon" data-fill={props.fill} data-color={props.color} />
    ),
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChatSummaryStarButton', () => {
    const channel = { channelID: 'ch1', channelType: 2 };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with default icon color', () => {
        render(<ChatSummaryStarButton channel={channel} />);
        const icon = screen.getByTestId('sparkle-icon');
        expect(icon.dataset.fill).toBe('none');
        expect(icon.dataset.color).toBe('currentColor');
    });

    it('icon stays default color even when hasSummaries is true', async () => {
        render(<ChatSummaryStarButton channel={channel} />);

        await act(async () => {
            window.dispatchEvent(
                new CustomEvent('chat-summary-created', {
                    detail: { channelId: 'ch1' },
                }),
            );
        });

        const icon = screen.getByTestId('sparkle-icon');
        expect(icon.dataset.fill).toBe('none');
        expect(icon.dataset.color).toBe('currentColor');
    });

    it('opens summary modal when no summaries exist', async () => {
        mockListSummaries.mockResolvedValue({ total: 0 });
        render(<ChatSummaryStarButton channel={channel} />);

        await act(async () => {
            fireEvent.click(screen.getByTitle('智能总结'));
            await flushPromises();
        });

        expect(mockEmit).toHaveBeenCalledWith('wk:open-summary-modal', {
            channelId: 'ch1',
            channelType: 2,
        });
    });

    it('opens summary panel when summaries exist', async () => {
        render(<ChatSummaryStarButton channel={channel} />);

        await act(async () => {
            window.dispatchEvent(
                new CustomEvent('chat-summary-created', {
                    detail: { channelId: 'ch1' },
                }),
            );
        });

        await act(async () => {
            fireEvent.click(screen.getByTitle('智能总结'));
            await flushPromises();
        });

        expect(mockEmit).toHaveBeenCalledWith('wk:toggle-summary-panel', {
            channelId: 'ch1',
            channelType: 2,
            summaryPanelView: 'history',
        });
    });
});
