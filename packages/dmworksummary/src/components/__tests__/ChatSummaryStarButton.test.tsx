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

const mockToastError = vi.fn();

vi.mock('@douyinfe/semi-ui', () => ({
    Toast: { error: (...args: any[]) => mockToastError(...args) },
}));

const mockIsCancel = vi.fn(() => false);

vi.mock('axios', () => ({
    default: { isCancel: (...args: any[]) => mockIsCancel(...args) },
}));

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
        mockIsCancel.mockReturnValue(false);
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

    it('does NOT open create modal when count query fails', async () => {
        mockListSummaries.mockRejectedValue(new Error('500'));
        render(<ChatSummaryStarButton channel={channel} />);

        await act(async () => {
            fireEvent.click(screen.getByTitle('智能总结'));
            await flushPromises();
        });

        // Load failure must not be treated as "no summaries".
        expect(mockEmit).not.toHaveBeenCalledWith('wk:open-summary-modal', expect.anything());
        expect(mockEmit).not.toHaveBeenCalledWith('wk:toggle-summary-panel', expect.anything());
        // An error is surfaced to the user instead.
        expect(mockToastError).toHaveBeenCalledWith('加载失败');
    });

    it('ignores a cancelled count query (no modal, no toast)', async () => {
        const cancelErr = { __CANCEL__: true };
        mockIsCancel.mockImplementation((e: unknown) => e === cancelErr);
        mockListSummaries.mockRejectedValue(cancelErr);
        render(<ChatSummaryStarButton channel={channel} />);

        await act(async () => {
            fireEvent.click(screen.getByTitle('智能总结'));
            await flushPromises();
        });

        expect(mockEmit).not.toHaveBeenCalledWith('wk:open-summary-modal', expect.anything());
        expect(mockEmit).not.toHaveBeenCalledWith('wk:toggle-summary-panel', expect.anything());
        expect(mockToastError).not.toHaveBeenCalled();
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
