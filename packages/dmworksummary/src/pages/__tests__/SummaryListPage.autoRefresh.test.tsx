import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Dropdown: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
    Banner: () => null,
    Tooltip: () => null,
}));
vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => null,
    IconPlus: () => null,
    IconRefresh: () => null,
}));
vi.mock('../../components/SummaryCard', () => ({ default: () => null }));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));
vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import SummaryListPage from '../SummaryListPage';
import { TaskStatus } from '../../types/summary';

/**
 * Build a page whose setState applies synchronously and runs the callback,
 * so refreshListSilently()'s post-setState side effects are exercised. Heavy
 * side effects (poll scheduling) are stubbed to no-ops. setState records
 * every patch it received so tests can assert on the flow, not just the
 * final value.
 */
function makePage(items: Array<Record<string, unknown>>) {
    const page = new SummaryListPage({} as any);
    const setStatePatches: Array<Record<string, unknown>> = [];
    (page as any).state = {
        ...(page.state as any),
        items,
        page: 1,
        pageSize: 20,
        statusFilter: undefined,
        keyword: '',
        loading: false,
        loadingMore: false,
        hasMore: true,
    };
    (page as any).isMounted_ = true;
    (page as any).setState = function (this: any, patch: any, cb?: () => void) {
        const resolved = typeof patch === 'function' ? patch(this.state) : patch;
        setStatePatches.push(resolved);
        this.state = { ...this.state, ...resolved };
        cb?.();
    };
    vi.spyOn(page as any, 'maybeStartBatchPoll').mockImplementation(() => {});
    vi.spyOn(page as any, 'stopBatchPoll').mockImplementation(() => {});
    return { page, setStatePatches };
}

describe('SummaryListPage auto-refresh on completion (#290)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('applies the local status patch immediately AND fires the silent refresh when a task reaches a terminal status', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [{ task_id: 1, status: TaskStatus.COMPLETED, topic: '完成后的标题' }],
            total: 1,
        } as any);

        const { page, setStatePatches } = makePage([
            { task_id: 1, status: TaskStatus.PROCESSING, topic: '旧标题' },
        ]);

        await (page as any).doBatchPoll([1]);
        await new Promise((r) => setTimeout(r, 0));

        // Local status patch applied BEFORE the async refresh lands, so the
        // card does not render a stale PROCESSING status for the round-trip.
        const firstPatch = setStatePatches[0];
        expect(firstPatch).toBeDefined();
        expect((firstPatch as any).items?.[0]).toMatchObject({ status: TaskStatus.COMPLETED });

        // Full list re-fetched and merged (enriched title visible).
        expect(api.listSummaries).toHaveBeenCalledTimes(1);
        expect((page.state as any).items[0]).toMatchObject({ topic: '完成后的标题' });

        // Silent: assert no setState patch ever tried to set loading:true.
        for (const p of setStatePatches) {
            expect((p as any).loading).not.toBe(true);
        }
    });

    it('only patches status in place for non-terminal transitions (no full reload)', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.PROCESSING },
        ] as any);

        const { page } = makePage([{ task_id: 1, status: TaskStatus.PENDING, topic: 'x' }]);

        await (page as any).doBatchPoll([1]);
        await new Promise((r) => setTimeout(r, 0));

        expect(api.listSummaries).not.toHaveBeenCalled();
        expect((page.state as any).items[0]).toMatchObject({ status: TaskStatus.PROCESSING });
    });

    /**
     * Merge-not-replace: when the refresh is clamped at 100 rows but the user
     * has loaded 120, the loaded tail past coverSize must be preserved
     * in-place (rows 101–120 keep showing). state.page is never touched by
     * the refresh, so the next loadMore continues from where the user left.
     */
    it('preserves the loaded tail past the refresh cap (merge, not replace)', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 42, status: TaskStatus.COMPLETED },
        ] as any);
        // Backend caps page_size at 100 — return 100 items with enriched
        // titles, plus a much larger total so hasMore stays true.
        const refreshedItems = Array.from({ length: 100 }, (_, i) => ({
            task_id: i + 1,
            status: TaskStatus.COMPLETED,
            topic: `enriched-${i + 1}`,
        }));
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: refreshedItems,
            total: 240,
        } as any);

        // Simulate user has 120 rows loaded, at page 6 with pageSize 20.
        // task 42 is currently PROCESSING; the poll detects it's COMPLETED.
        const initialItems = Array.from({ length: 120 }, (_, i) => ({
            task_id: i + 1,
            status: i === 41 ? TaskStatus.PROCESSING : TaskStatus.COMPLETED,
            topic: `old-${i + 1}`,
        }));
        const { page } = makePage(initialItems);
        (page as any).state = { ...(page as any).state, page: 6, pageSize: 20 };

        await (page as any).doBatchPoll([42]);
        await new Promise((r) => setTimeout(r, 0));

        expect(api.listSummaries).toHaveBeenCalledTimes(1);

        // Prefix 1..100 got enriched (fresh title), tail 101..120 preserved
        // in place (old title). Task 42 in the prefix now has the enriched
        // topic AND the COMPLETED status.
        const items = (page.state as any).items;
        expect(items).toHaveLength(120);
        expect(items[0].topic).toBe('enriched-1');
        expect(items[41].status).toBe(TaskStatus.COMPLETED);
        expect(items[99].topic).toBe('enriched-100');
        expect(items[100].topic).toBe('old-101');
        expect(items[119].topic).toBe('old-120');

        // state.page must NOT be touched — refresh preserves the cursor.
        expect((page.state as any).page).toBe(6);
    });

    /**
     * When resp.items contains a brand-new task_id not in state.items (a task
     * created after the initial load), it lands at the top of the list.
     */
    it('inserts brand-new tasks from the refresh at the top of the list', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [
                { task_id: 999, status: TaskStatus.COMPLETED, topic: 'brand-new-task' },
                { task_id: 1, status: TaskStatus.COMPLETED, topic: 'enriched-existing' },
            ],
            total: 2,
        } as any);

        const { page } = makePage([
            { task_id: 1, status: TaskStatus.PROCESSING, topic: 'old-existing' },
        ]);

        await (page as any).doBatchPoll([1]);
        await new Promise((r) => setTimeout(r, 0));

        const items = (page.state as any).items;
        expect(items).toHaveLength(2);
        expect(items[0].task_id).toBe(999);
        expect(items[0].topic).toBe('brand-new-task');
        expect(items[1].task_id).toBe(1);
        expect(items[1].topic).toBe('enriched-existing');
    });

    /**
     * If a concurrent loadMore appends a page while the refresh is in flight,
     * merge-not-replace preserves the appended tail by construction: the
     * setState uses the LATEST state.items (via functional updater), so any
     * rows that landed during the fetch are still present.
     */
    it('preserves items appended by a concurrent loadMore (merge-not-replace)', async () => {
        // 120 rows loaded at page 6.
        const initialItems = Array.from({ length: 120 }, (_, i) => ({
            task_id: i + 1,
            status: TaskStatus.COMPLETED,
            topic: `t${i + 1}`,
        }));
        const { page } = makePage(initialItems);
        (page as any).state = { ...(page as any).state, page: 6, pageSize: 20 };

        let resolveRefresh: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockImplementationOnce(
            () => new Promise((r) => { resolveRefresh = r; }) as any
        );

        // Fire refresh directly, don't await.
        const refreshPromise = (page as any).refreshListSilently();
        await new Promise((r) => setTimeout(r, 0));

        // Simulate loadMore having landed while the refresh awaited:
        // 20 new rows appended, page advanced.
        const appendedItems = Array.from({ length: 20 }, (_, i) => ({
            task_id: i + 121,
            status: TaskStatus.COMPLETED,
            topic: `page7-${i + 121}`,
        }));
        (page as any).state = {
            ...(page as any).state,
            items: [...(page as any).state.items, ...appendedItems],
            page: 7,
        };

        // Refresh resolves with 100 rows.
        resolveRefresh({
            items: Array.from({ length: 100 }, (_, i) => ({
                task_id: i + 1,
                status: TaskStatus.COMPLETED,
                topic: `enriched-${i + 1}`,
            })),
            total: 240,
        });
        await refreshPromise;

        // The appended tail must survive: rows 121-140 still there, page 7
        // preserved. Prefix 1-100 enriched; 101-120 old; 121-140 appended.
        const items = (page.state as any).items;
        expect(items).toHaveLength(140);
        expect((page.state as any).page).toBe(7);
        expect(items[0].topic).toBe('enriched-1');
        expect(items[100].topic).toBe('t101');
        expect(items[139].topic).toBe('page7-140');
    });

    /**
     * Drop stale response when the status filter changed mid-flight.
     */
    it('drops the refresh response if the status filter changed while the fetch was in flight', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);

        let resolveList: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockReturnValue(
            new Promise((r) => { resolveList = r; }) as any
        );

        const { page } = makePage([{ task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' }]);

        const pollPromise = (page as any).doBatchPoll([1]);
        await new Promise((r) => setTimeout(r, 0));

        // User picks a filter mid-flight.
        (page as any).state = { ...(page as any).state, statusFilter: TaskStatus.COMPLETED };

        resolveList({
            items: [{ task_id: 999, status: TaskStatus.COMPLETED, topic: 'filtered' }],
            total: 999,
        });
        await pollPromise;
        await new Promise((r) => setTimeout(r, 0));

        // Stale response dropped — items still reflects the local patch (COMPLETED task 1),
        // not the filtered response.
        expect((page.state as any).items).toHaveLength(1);
        expect((page.state as any).items[0].task_id).toBe(1);
        expect((page.state as any).total).not.toBe(999);
    });

    /**
     * When the refresh throws, the local status patch survives; isRefreshing
     * resets so the next tick can retry (though structurally a second retry
     * won't happen for the same transition, since the local patch stops the
     * "change detected" branch).
     */
    it('preserves the local status patch when the refresh request throws', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);
        vi.mocked(api.listSummaries).mockRejectedValue(new Error('refresh failed'));

        const { page } = makePage([{ task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' }]);

        await (page as any).doBatchPoll([1]);
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }

        expect((page.state as any).items[0]).toMatchObject({ status: TaskStatus.COMPLETED });
        expect((page as any).isRefreshing).toBe(false);
    });
});
