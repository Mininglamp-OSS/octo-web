import React from 'react';
import { render as rtlRender, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SummaryListPage from '../SummaryListPage';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: {
            mittBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
            routeRight: { popToRoot: vi.fn(), push: vi.fn() },
        },
    };
});

const mockListSummaries = vi.fn();
const mockBatchStatus = vi.fn();
const mockDeleteSummary = vi.fn();

vi.mock('../../api/summaryApi', () => ({
    listSummaries: (...args: any[]) => mockListSummaries(...args),
    batchStatus: (...args: any[]) => mockBatchStatus(...args),
    deleteSummary: (...args: any[]) => mockDeleteSummary(...args),
    respondToTask: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../components/SummaryCard', () => ({
    default: ({ task }: any) => (
        <div data-testid="summary-card" data-status={task.status} data-title={task.title}>
            {task.title}
        </div>
    ),
}));

vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));

vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, icon, ...rest }: any) => (
        <button onClick={onClick} {...rest}>{icon}{children}</button>
    ),
    Input: ({ value, onChange, placeholder }: any) => (
        <input
            data-testid="search-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
    Select: ({ children, value, onChange }: any) => (
        <select data-testid="status-filter" value={value} onChange={(e) => onChange(e.target.value)}>
            {children}
        </select>
    ),
    Spin: ({ size }: any) => <div data-testid="spin" data-size={size} />,
    Pagination: () => <div data-testid="pagination" />,
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Banner: ({ description }: any) => <div data-testid="banner">{description}</div>,
    Tooltip: ({ children }: any) => <>{children}</>,
}));

(vi.mocked as any) ?? null;
// Select.Option child stub
import * as Semi from '@douyinfe/semi-ui';
(Semi as any).Select.Option = ({ children, value }: any) => <option value={String(value)}>{children}</option>;

vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => <span data-testid="icon-search" />,
    IconPlus: () => <span data-testid="icon-plus" />,
    IconRefresh: () => <span data-testid="icon-refresh" />,
}));

vi.mock('../../utils/summaryHelpers', () => ({
    getStatusLabel: (s: number) => {
        const labels: Record<number, string> = { 0: '待处理', 1: '待确认', 2: '进行中', 3: '已完成', 4: '失败', 5: '已取消' };
        return labels[s] ?? '未知';
    },
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
        title: '原始标题',
        summary_mode: 1,
        status: 2,
        trigger_type: 1,
        time_range_start: '2026-01-01T00:00:00Z',
        time_range_end: '2026-01-02T00:00:00Z',
        sources: [],
        total_msg_count: 0,
        creator_name: 'TestUser',
        origin_channel_id: 'ch1',
        origin_channel_type: 2,
        created_at: '2026-01-01T09:30:00Z',
        completed_at: null,
        ...overrides,
    };
}

describe('SummaryListPage — terminal reload (#290)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // Default for the badge endpoint (page_size=1) and any unqueued main-list call.
        mockListSummaries.mockResolvedValue({ items: [], total: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // emitBadgeUpdate also calls listSummaries (with page_size=1) — filter those
    // out when asserting how many times the main list endpoint was hit.
    const mainListCalls = () =>
        mockListSummaries.mock.calls.filter(c => c[0]?.page_size !== 1);

    it('[FIX] silent loadData call does NOT set loading=true', async () => {
        mockListSummaries.mockResolvedValue({ items: [], total: 0 });

        let instance: any;
        await act(async () => {
            const { container } = render(<SummaryListPage ref={(r: any) => { instance = r; }} />);
            container; // silence linter
            await vi.advanceTimersByTimeAsync(0);
        });

        const states: boolean[] = [];
        const origSetState = instance.setState.bind(instance);
        instance.setState = (patch: any, cb?: any) => {
            if (typeof patch === 'object' && patch && 'loading' in patch) {
                states.push(patch.loading);
            }
            return origSetState(patch, cb);
        };

        mockListSummaries.mockResolvedValue({ items: [makeItem({ status: 3 })], total: 1 });
        await act(async () => {
            await instance.loadData({ silent: true });
        });

        expect(states).not.toContain(true);
    });

    it('[FIX] non-silent loadData (default) still sets loading=true', async () => {
        mockListSummaries.mockResolvedValue({ items: [], total: 0 });

        let instance: any;
        await act(async () => {
            render(<SummaryListPage ref={(r: any) => { instance = r; }} />);
            await vi.advanceTimersByTimeAsync(0);
        });

        const states: boolean[] = [];
        const origSetState = instance.setState.bind(instance);
        instance.setState = (patch: any, cb?: any) => {
            if (typeof patch === 'object' && patch && 'loading' in patch) {
                states.push(patch.loading);
            }
            return origSetState(patch, cb);
        };

        mockListSummaries.mockResolvedValue({ items: [makeItem({ status: 3 })], total: 1 });
        await act(async () => {
            await instance.loadData();
        });

        expect(states).toContain(true);
    });

    it('[FIX] doBatchPoll triggers silent reload when a task transitions to COMPLETED', async () => {
        mockListSummaries.mockResolvedValueOnce({
            items: [makeItem({ task_id: 1, status: 2, title: 'original title' })],
            total: 1,
        });

        await act(async () => {
            render(<SummaryListPage />);
            await vi.advanceTimersByTimeAsync(0);
        });

        // First fetch already happened on mount. Reset for clear assertion.
        expect(mainListCalls()).toHaveLength(1);

        // Set up: batch returns task as COMPLETED. Next listSummaries returns updated title.
        mockBatchStatus.mockResolvedValueOnce([{ id: 1, status: 3, progress: 100, updated_at: '' }]);
        mockListSummaries.mockResolvedValueOnce({
            items: [makeItem({ task_id: 1, status: 3, title: 'POST-completion title' })],
            total: 1,
        });

        // Advance 2s → batch poll fires → detects terminal → triggers silent reload.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });

        expect(mockBatchStatus).toHaveBeenCalledWith([1]);
        // listSummaries should be called a second time (the silent reload).
        expect(mainListCalls()).toHaveLength(2);
    });

    it('[FIX] doBatchPoll does NOT silent reload on intermediate (PENDING -> PROCESSING)', async () => {
        mockListSummaries.mockResolvedValueOnce({
            items: [makeItem({ task_id: 1, status: 0 })],
            total: 1,
        });

        await act(async () => {
            render(<SummaryListPage />);
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(mainListCalls()).toHaveLength(1);

        mockBatchStatus.mockResolvedValueOnce([{ id: 1, status: 2, progress: 30, updated_at: '' }]);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });

        expect(mockBatchStatus).toHaveBeenCalledWith([1]);
        // listSummaries should NOT be called again — in-place setState path only.
        expect(mainListCalls()).toHaveLength(1);
    });

    it('[FIX] doBatchPoll triggers silent reload on FAILED and CANCELLED too', async () => {
        for (const terminalStatus of [4, 5]) {
            vi.clearAllMocks();
            mockListSummaries.mockResolvedValueOnce({
                items: [makeItem({ task_id: 1, status: 2 })],
                total: 1,
            });

            let unmountFn: (() => void) | undefined;
            await act(async () => {
                const { unmount } = render(<SummaryListPage />);
                unmountFn = unmount;
                await vi.advanceTimersByTimeAsync(0);
            });

            mockBatchStatus.mockResolvedValueOnce([{ id: 1, status: terminalStatus, progress: 100, updated_at: '' }]);
            mockListSummaries.mockResolvedValueOnce({
                items: [makeItem({ task_id: 1, status: terminalStatus })],
                total: 1,
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(2000);
            });

            expect(mainListCalls()).toHaveLength(2);

            await act(async () => { unmountFn?.(); });
        }
    });

    it('[FIX] summary-status-change event is dispatched on both terminal and intermediate transitions', async () => {
        const onStatusChange = vi.fn();
        window.addEventListener('summary-status-change', onStatusChange as EventListener);

        // intermediate
        mockListSummaries.mockResolvedValueOnce({
            items: [makeItem({ task_id: 1, status: 0 })],
            total: 1,
        });
        let unmount1: (() => void) | undefined;
        await act(async () => {
            const r = render(<SummaryListPage />);
            unmount1 = r.unmount;
            await vi.advanceTimersByTimeAsync(0);
        });
        mockBatchStatus.mockResolvedValueOnce([{ id: 1, status: 2, progress: 30, updated_at: '' }]);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(onStatusChange).toHaveBeenCalledTimes(1);
        await act(async () => { unmount1?.(); });

        // terminal
        vi.clearAllMocks();
        onStatusChange.mockClear();
        mockListSummaries.mockResolvedValueOnce({
            items: [makeItem({ task_id: 2, status: 2 })],
            total: 1,
        });
        let unmount2: (() => void) | undefined;
        await act(async () => {
            const r = render(<SummaryListPage />);
            unmount2 = r.unmount;
            await vi.advanceTimersByTimeAsync(0);
        });
        mockBatchStatus.mockResolvedValueOnce([{ id: 2, status: 3, progress: 100, updated_at: '' }]);
        mockListSummaries.mockResolvedValueOnce({ items: [], total: 0 });
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(onStatusChange).toHaveBeenCalledTimes(1);
        await act(async () => { unmount2?.(); });

        window.removeEventListener('summary-status-change', onStatusChange as EventListener);
    });
});
