import React from 'react';
import { render as rtlRender, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChatSummaryHistory from '../ChatSummaryHistory';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: { mittBus: { emit: vi.fn() } },
    };
});

const mockListSummaries = vi.fn();
const mockBatchStatus = vi.fn();
const mockDeleteSummary = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../api/summaryApi', () => ({
    listSummaries: (...args: any[]) => mockListSummaries(...args),
    batchStatus: (...args: any[]) => mockBatchStatus(...args),
    deleteSummary: (...args: any[]) => mockDeleteSummary(...args),
}));

vi.mock('../../utils/summaryHelpers', () => ({
    getStatusLabel: (status: number) => {
        const labels: Record<number, string> = { 0: '待处理', 1: '待确认', 2: '进行中', 3: '已完成', 4: '失败', 5: '已取消' };
        return labels[status] ?? '未知';
    },
    getStatusColor: (status: number) => {
        const colors: Record<number, string> = { 0: 'grey', 1: 'amber', 2: 'blue', 3: 'green', 4: 'red', 5: 'grey' };
        return colors[status] ?? 'grey';
    },
}));

vi.mock('@douyinfe/semi-ui', () => ({
    Toast: { error: (...args: any[]) => mockToastError(...args) },
    Tag: ({ children, color, size }: any) => (
        <span data-testid="status-tag" data-color={color} data-size={size}>{children}</span>
    ),
    Tooltip: ({ children }: any) => <>{children}</>,
    Button: ({ icon, onClick }: any) => (
        <button data-testid="delete-btn" onClick={onClick}>{icon}</button>
    ),
    Popconfirm: ({ children, onConfirm }: any) => (
        <span
            data-testid="popconfirm"
            onClick={() => onConfirm({ stopPropagation: () => {} })}
        >
            {children}
        </span>
    ),
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconDelete: () => <svg data-testid="delete-icon" />,
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeItem(overrides: Record<string, unknown> = {}) {
    return {
        task_id: 1,
        task_no: 'T001',
        title: '测试总结',
        summary_mode: 1,
        status: 3,
        trigger_type: 1,
        time_range_start: '2026-01-01T00:00:00Z',
        time_range_end: '2026-01-02T00:00:00Z',
        sources: [{ source_type: 1, source_id: 's1' }],
        total_msg_count: 10,
        creator_name: '张三',
        origin_channel_id: 'ch1',
        origin_channel_type: 2,
        created_at: '2026-01-01T09:30:00Z',
        completed_at: '2026-01-01T10:00:00Z',
        ...overrides,
    };
}

describe('ChatSummaryHistory', () => {
    const channel = { channelID: 'ch1', channelType: 2 };
    const onCreateNew = vi.fn();
    const onViewDetail = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders status badge for each item', async () => {
        mockListSummaries.mockResolvedValue({
            items: [
                makeItem({ task_id: 1, status: 3, title: '已完成任务' }),
                makeItem({ task_id: 2, status: 2, title: '进行中任务' }),
            ],
        });

        await act(async () => {
            render(
                <ChatSummaryHistory
                    channel={channel}
                    onCreateNew={onCreateNew}
                    onViewDetail={onViewDetail}
                />,
            );
            await flushPromises();
        });

        const tags = screen.getAllByTestId('status-tag');
        expect(tags).toHaveLength(2);
        expect(tags[0]).toHaveTextContent('已完成');
        expect(tags[0].dataset.color).toBe('green');
        expect(tags[1]).toHaveTextContent('进行中');
        expect(tags[1].dataset.color).toBe('blue');
    });

    it('renders title, creator, date, and status via SummaryCard', async () => {
        mockListSummaries.mockResolvedValue({
            items: [makeItem({ title: '已完成任务', creator_name: '李四', created_at: '2026-01-01T09:30:00Z' })],
        });

        await act(async () => {
            render(
                <ChatSummaryHistory
                    channel={channel}
                    onCreateNew={onCreateNew}
                    onViewDetail={onViewDetail}
                />,
            );
            await flushPromises();
        });

        expect(screen.getByText('已完成任务')).toBeInTheDocument();
        // Subtitle matches the tab: "{name} 发起" with no source count.
        expect(screen.getByText(/李四 发起/)).toBeInTheDocument();
        expect(screen.queryByText(/个来源/)).not.toBeInTheDocument();
        // Date is the YYYY-MM-DD prefix, not an HH:MM time.
        expect(screen.getByText('2026-01-01')).toBeInTheDocument();
        expect(screen.getByTestId('status-tag')).toBeInTheDocument();
    });

    it('falls back to task_no when title is empty', async () => {
        mockListSummaries.mockResolvedValue({
            items: [makeItem({ title: '', task_no: 'T999' })],
        });

        await act(async () => {
            render(
                <ChatSummaryHistory
                    channel={channel}
                    onCreateNew={onCreateNew}
                    onViewDetail={onViewDetail}
                />,
            );
            await flushPromises();
        });

        expect(screen.getByText('T999')).toBeInTheDocument();
    });

    it('deletes a summary and refreshes the list via chat-summary-deleted event', async () => {
        mockListSummaries.mockResolvedValue({ items: [makeItem({ task_id: 7 })] });
        mockDeleteSummary.mockResolvedValue(undefined);
        const onDeleted = vi.fn();
        window.addEventListener('chat-summary-deleted', onDeleted as EventListener);

        await act(async () => {
            render(
                <ChatSummaryHistory
                    channel={channel}
                    onCreateNew={onCreateNew}
                    onViewDetail={onViewDetail}
                />,
            );
            await flushPromises();
        });

        await act(async () => {
            screen.getByTestId('popconfirm').click();
            await flushPromises();
        });

        expect(mockDeleteSummary).toHaveBeenCalledWith(7);
        expect(onDeleted).toHaveBeenCalled();
        const event = onDeleted.mock.calls[0][0] as CustomEvent;
        expect(event.detail).toEqual({ channelId: 'ch1' });

        window.removeEventListener('chat-summary-deleted', onDeleted as EventListener);
    });

    it('shows a toast and keeps the item when delete fails', async () => {
        mockListSummaries.mockResolvedValue({ items: [makeItem({ task_id: 7 })] });
        mockDeleteSummary.mockRejectedValue(new Error('boom'));
        const onDeleted = vi.fn();
        window.addEventListener('chat-summary-deleted', onDeleted as EventListener);

        await act(async () => {
            render(
                <ChatSummaryHistory
                    channel={channel}
                    onCreateNew={onCreateNew}
                    onViewDetail={onViewDetail}
                />,
            );
            await flushPromises();
        });

        await act(async () => {
            screen.getByTestId('popconfirm').click();
            await flushPromises();
        });

        expect(mockDeleteSummary).toHaveBeenCalledWith(7);
        expect(mockToastError).toHaveBeenCalledWith('删除失败');
        expect(onDeleted).not.toHaveBeenCalled();

        window.removeEventListener('chat-summary-deleted', onDeleted as EventListener);
    });

    it('does not poll when all items are completed', async () => {
        mockListSummaries.mockResolvedValue({
            items: [makeItem({ task_id: 1, status: 3 })],
        });

        await act(async () => {
            render(
                <ChatSummaryHistory
                    channel={channel}
                    onCreateNew={onCreateNew}
                    onViewDetail={onViewDetail}
                />,
            );
            await flushPromises();
        });

        expect(mockBatchStatus).not.toHaveBeenCalled();
    });

    describe('polling', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('starts polling when items have active status', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 3, progress: 100, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            expect(screen.getByTestId('status-tag')).toHaveTextContent('进行中');

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });

            expect(mockBatchStatus).toHaveBeenCalledWith([1]);
            expect(screen.getByTestId('status-tag')).toHaveTextContent('已完成');
        });

        it('stops polling after status transitions to terminal', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 0 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 3, progress: 100, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });

            expect(mockBatchStatus).toHaveBeenCalledTimes(1);
            mockBatchStatus.mockClear();

            await act(async () => {
                await vi.advanceTimersByTimeAsync(10000);
            });

            expect(mockBatchStatus).not.toHaveBeenCalled();
        });

        it('does not start polling when mounted with paused=true', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                        paused
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(10000);
            });

            expect(mockBatchStatus).not.toHaveBeenCalled();
        });

        it('stops polling when paused flips to true and resumes when it flips back', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 2, progress: 50, updated_at: '' }]);

            let rerender: (ui: React.ReactElement) => void;
            await act(async () => {
                const result = render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                        paused={false}
                    />,
                );
                rerender = result.rerender;
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalled();

            // 进入详情：暂停轮询
            await act(async () => {
                rerender!(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                        paused
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });
            mockBatchStatus.mockClear();

            await act(async () => {
                await vi.advanceTimersByTimeAsync(15000);
            });
            expect(mockBatchStatus).not.toHaveBeenCalled();

            // 返回列表：刷新一次并恢复轮询
            mockListSummaries.mockClear();
            await act(async () => {
                rerender!(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                        paused={false}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockListSummaries).toHaveBeenCalled();

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalled();
        });

        it('cleans up poll timer on unmount', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });

            let unmount: () => void;
            await act(async () => {
                const result = render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                unmount = result.unmount;
                await vi.advanceTimersByTimeAsync(0);
            });

            act(() => unmount!());

            await act(async () => {
                await vi.advanceTimersByTimeAsync(10000);
            });

            expect(mockBatchStatus).not.toHaveBeenCalled();
        });
    });

    describe('heartbeat coordination (#334)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('skips the next 5s tick when a covering heartbeat arrives', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 2, progress: 50, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-batch-heartbeat', { detail: { taskIds: [1, 2, 3] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).not.toHaveBeenCalled();
        });

        it('polls again after the 15s freshness window expires', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 2, progress: 50, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-batch-heartbeat', { detail: { taskIds: [1] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).not.toHaveBeenCalled();

            // Move past the 15s freshness window from the heartbeat moment.
            // Heartbeat at T=0; ticks fire at T=5000,10000,15000,20000.
            // T=15000 delta=15000 is still fresh (<=15000), so the next
            // unsuppressed tick is at T=20000. Advance to T>=20000 total.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(15500);
            });
            expect(mockBatchStatus).toHaveBeenCalled();
        });

        it('does not skip when the heartbeat is non-covering (partial overlap)', async () => {
            mockListSummaries.mockResolvedValue({
                items: [
                    makeItem({ task_id: 1, status: 2 }),
                    makeItem({ task_id: 2, status: 2, title: 'Second' }),
                ],
            });
            mockBatchStatus.mockResolvedValue([
                { id: 1, status: 2, progress: 50, updated_at: '' },
                { id: 2, status: 2, progress: 50, updated_at: '' },
            ]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-batch-heartbeat', { detail: { taskIds: [1] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalledWith([1, 2]);
        });

        it('does not skip when the heartbeat payload is empty and I have active ids', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 2, progress: 50, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-batch-heartbeat', { detail: { taskIds: [] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalledWith([1]);
        });

        it('dispatches a covering heartbeat with our own active ids after a successful poll', async () => {
            mockListSummaries.mockResolvedValue({
                items: [
                    makeItem({ task_id: 7, status: 2 }),
                    makeItem({ task_id: 9, status: 0, title: 'Pending' }),
                ],
            });
            mockBatchStatus.mockResolvedValue([
                { id: 7, status: 2, progress: 30, updated_at: '' },
                { id: 9, status: 0, progress: 0, updated_at: '' },
            ]);
            const onHeartbeat = vi.fn();
            window.addEventListener('summary-batch-heartbeat', onHeartbeat as EventListener);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });

            const calls = onHeartbeat.mock.calls.filter(([e]) => (e as CustomEvent).detail);
            expect(calls.length).toBeGreaterThanOrEqual(1);
            const lastDetail = (calls[calls.length - 1][0] as CustomEvent).detail as { taskIds: number[] };
            expect(lastDetail.taskIds).toEqual(expect.arrayContaining([7, 9]));

            window.removeEventListener('summary-batch-heartbeat', onHeartbeat as EventListener);
        });

        it('does not self-suppress: solo polling stays at 5s cadence (self-echo guard)', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 2, progress: 50, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            // First tick: dispatches a heartbeat. Without the self-echo guard,
            // peerActive would flip true here and starve the second tick.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalledTimes(1);

            // Second tick: must still fire (no peer was ever broadcasting).
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalledTimes(2);

            // Third tick for good measure — still steady 5s cadence.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalledTimes(3);
        });

        it('refreshes history when summary-status-change intersects current items', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            mockListSummaries.mockClear();
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 3 })],
            });

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-status-change', { detail: { taskIds: [1] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            expect(mockListSummaries).toHaveBeenCalled();
        });

        it('ignores summary-status-change when taskIds do not intersect current items', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            mockListSummaries.mockClear();

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-status-change', { detail: { taskIds: [99] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            expect(mockListSummaries).not.toHaveBeenCalled();
        });

        it('clears suppression on summary-list-unmount so the next tick polls', async () => {
            mockListSummaries.mockResolvedValue({
                items: [makeItem({ task_id: 1, status: 2 })],
            });
            mockBatchStatus.mockResolvedValue([{ id: 1, status: 2, progress: 50, updated_at: '' }]);

            await act(async () => {
                render(
                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={onCreateNew}
                        onViewDetail={onViewDetail}
                    />,
                );
                await vi.advanceTimersByTimeAsync(0);
            });

            // Establish suppression first.
            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('summary-batch-heartbeat', { detail: { taskIds: [1] } }),
                );
                await vi.advanceTimersByTimeAsync(0);
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).not.toHaveBeenCalled();

            // Peer goes away.
            await act(async () => {
                window.dispatchEvent(new CustomEvent('summary-list-unmount'));
                await vi.advanceTimersByTimeAsync(0);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(mockBatchStatus).toHaveBeenCalledWith([1]);
        });
    });
});
