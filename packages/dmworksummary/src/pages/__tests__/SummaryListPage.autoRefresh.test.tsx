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
 * so doBatchPoll's local patch + fire-and-forget refresh (which now delegates
 * to loadData) are exercised in a deterministic order. Heavy side effects
 * (poll scheduling) are stubbed to no-ops.
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

    it('applies the local status patch immediately AND triggers a full reload via loadData when a task reaches a terminal status', async () => {
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
        // Yield for the fire-and-forget refresh (which awaits loadData) to
        // complete its full setState chain.
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }

        // Local status patch was applied to items BEFORE the loadData round
        // trip, so the card did not sit at a stale PROCESSING status.
        // Find the first patch that carries the items array with COMPLETED status.
        const localPatch = setStatePatches.find(
            (p: any) => Array.isArray(p.items) && p.items[0]?.status === TaskStatus.COMPLETED
        );
        expect(localPatch).toBeDefined();

        // loadData was invoked (via refreshListSilently) and enriched the row.
        expect(api.listSummaries).toHaveBeenCalledTimes(1);
        expect((page.state as any).items[0]).toMatchObject({ topic: '完成后的标题' });
    });

    it('only patches status in place for non-terminal transitions (no reload)', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.PROCESSING },
        ] as any);

        const { page } = makePage([{ task_id: 1, status: TaskStatus.PENDING, topic: 'x' }]);

        await (page as any).doBatchPoll([1]);
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }

        // Non-terminal → no full reload.
        expect(api.listSummaries).not.toHaveBeenCalled();
        expect((page.state as any).items[0]).toMatchObject({ status: TaskStatus.PROCESSING });
    });

    /**
     * Under a status filter (e.g. PROCESSING), a task that reaches a terminal
     * status must drop out of the filtered view. Delegating to loadData()
     * gets this right by construction: the server's PROCESSING-scoped
     * response no longer contains the completed task, and loadData replaces
     * items wholesale (rather than merging), so the completed row cleanly
     * disappears.
     */
    it('drops rows that no longer match the active status filter after a terminal transition', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);
        // Under statusFilter=PROCESSING, the server response omits the just-
        // completed task, leaving only the other PROCESSING task.
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [{ task_id: 2, status: TaskStatus.PROCESSING, topic: 'still-processing' }],
            total: 1,
        } as any);

        const { page } = makePage([
            { task_id: 1, status: TaskStatus.PROCESSING, topic: 'about-to-complete' },
            { task_id: 2, status: TaskStatus.PROCESSING, topic: 'still-processing' },
        ]);
        (page as any).state = { ...(page as any).state, statusFilter: TaskStatus.PROCESSING };

        await (page as any).doBatchPoll([1, 2]);
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }

        // Completed task 1 dropped from filtered view; only task 2 remains.
        const items = (page.state as any).items;
        expect(items).toHaveLength(1);
        expect(items[0].task_id).toBe(2);
    });

    /**
     * refreshListSilently is a fire-and-forget from doBatchPoll's setState
     * callback. If the component unmounts between the setState and the
     * refresh reaching loadData, the isMounted_ guard must short-circuit
     * so we don't call setState on a torn-down instance.
     */
    it('short-circuits refreshListSilently when unmounted', async () => {
        const { page } = makePage([
            { task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' },
        ]);
        // Simulate unmount before the refresh is invoked.
        (page as any).isMounted_ = false;

        await (page as any).refreshListSilently();

        // No fetch fired; loadData was never called.
        expect(api.listSummaries).not.toHaveBeenCalled();
    });

    /**
     * Concurrent refresh calls are coalesced by isRefreshing — a second
     * doBatchPoll tick that fires while the first refresh is still in flight
     * must short-circuit rather than pile on a duplicate loadData round trip.
     */
    it('coalesces overlapping refresh calls via isRefreshing', async () => {
        let resolveList: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockReturnValue(
            new Promise((r) => { resolveList = r; }) as any
        );

        const { page } = makePage([
            { task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' },
        ]);

        // Kick off the first refresh; don't await.
        const first = (page as any).refreshListSilently();
        // Second, overlapping refresh: must short-circuit.
        const second = (page as any).refreshListSilently();
        await second;
        expect(api.listSummaries).toHaveBeenCalledTimes(1);

        // Let the first refresh finish so isRefreshing resets.
        resolveList({ items: [], total: 0 });
        await first;
    });

    /**
     * P1-1 regression (yujiawei round-5): if loadMore is in flight when the
     * background refresh (via loadData) resets page to 1 and replaces items,
     * appending loadMore's stale response would splice a hole. The
     * `prev.page !== nextPage - 1` guard in loadMore must discard the batch
     * instead. Cover both interleavings.
     */
    it('discards a stale loadMore response when refresh reset the list first', async () => {
        // Start at page 5, 100 rows loaded, hasMore=true.
        const initialItems = Array.from({ length: 100 }, (_, i) => ({
            task_id: i + 1,
            status: TaskStatus.COMPLETED,
            topic: `t${i + 1}`,
        }));
        const { page } = makePage(initialItems);
        (page as any).state = {
            ...(page as any).state,
            page: 5,
            pageSize: 20,
            hasMore: true,
        };

        // loadMore fires: captures nextPage=6, awaits.
        let resolveLoadMore: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockImplementationOnce(
            () => new Promise((r) => { resolveLoadMore = r; }) as any
        );
        const loadMorePromise = (page as any).loadMore();
        await new Promise((r) => setTimeout(r, 0));

        // Simulate a concurrent refresh landing first: it reset page to 1 and
        // replaced items with a fresh page-1 batch.
        (page as any).state = {
            ...(page as any).state,
            items: Array.from({ length: 20 }, (_, i) => ({
                task_id: i + 1,
                status: TaskStatus.COMPLETED,
                topic: `fresh-${i + 1}`,
            })),
            page: 1,
            hasMore: true,
        };

        // Now loadMore's stale page-6 response resolves.
        resolveLoadMore({
            items: Array.from({ length: 20 }, (_, i) => ({
                task_id: i + 101,
                status: TaskStatus.COMPLETED,
                topic: `stale-${i + 101}`,
            })),
            total: 200,
        });
        await loadMorePromise;

        // The stale batch must be discarded: items stays at the fresh page-1
        // (20 rows, page=1) — no hole is spliced in, no stale rows appended.
        const items = (page.state as any).items;
        expect(items).toHaveLength(20);
        expect((page.state as any).page).toBe(1);
        expect(items[0].topic).toBe('fresh-1');
        expect(items[19].topic).toBe('fresh-20');
        // loadingMore reset so scroll can resume.
        expect((page.state as any).loadingMore).toBe(false);
    });

    /**
     * P2-6 regression: a failed background refresh should not surface an
     * error banner to an idle user. If loadData sets state.error during the
     * refresh, refreshListSilently must clear it (unless there was already
     * a pre-refresh error, which is unrelated and should be preserved).
     */
    it('suppresses the loadData error banner on background refresh failure', async () => {
        vi.mocked(api.listSummaries).mockRejectedValue(new Error('network'));

        const { page } = makePage([
            { task_id: 1, status: TaskStatus.COMPLETED, topic: 'x' },
        ]);
        expect((page.state as any).error).toBeFalsy();

        await (page as any).refreshListSilently();

        // The error banner must not persist on an otherwise healthy list.
        expect((page.state as any).error).toBeFalsy();
    });
});
