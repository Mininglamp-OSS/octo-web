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

    it('triggers a full reload via loadData when a task reaches a terminal status (round-9: no local patch)', async () => {
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
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }

        // Terminal branch delegates directly to loadData without an
        // intermediate local status patch (round-9 yujiawei P1 fix). The
        // ONLY items commit should come from loadData's success path with
        // the fresh title, not an earlier local COMPLETED-status patch.
        // Rationale: pre-patching to COMPLETED would strand the task in
        // stopBatchPoll if the refresh fails, preventing self-retry.
        const itemsCommits = setStatePatches.filter((p: any) => Array.isArray(p.items));
        expect(itemsCommits).toHaveLength(1);
        expect((itemsCommits[0] as any).items[0]).toMatchObject({
            status: TaskStatus.COMPLETED,
            topic: '完成后的标题',
        });

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

        // Simulate a concurrent refresh landing first: it reset page to 1,
        // replaced items with a fresh page-1 batch, AND bumped loadDataSeq
        // (which is what real loadData does at entry).
        (page as any).loadDataSeq++;
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
     * error banner to an idle user. loadData now takes a { silent: true }
     * flag; refreshListSilently passes it so the catch branch skips the
     * error setState entirely (rather than trying to clear it after commit).
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

    /**
     * P1-1 regression at nextPage === 2 (round-7 Jerry-Xin / yujiawei): the
     * previous `prev.page !== nextPage - 1` guard was a no-op here because
     * loadData also resets page to 1 — "list was reset" and "nothing changed"
     * both looked like `prev.page === 1`. Now loadMore captures loadDataSeq
     * pre-await and drops the batch when it advances.
     */
    it('discards a stale loadMore@page-2 response when a concurrent loadData ran', async () => {
        const { page } = makePage(
            Array.from({ length: 20 }, (_, i) => ({
                task_id: i + 1,
                status: TaskStatus.COMPLETED,
                topic: `t${i + 1}`,
            }))
        );
        (page as any).state = {
            ...(page as any).state,
            page: 1,
            pageSize: 20,
            hasMore: true,
        };

        // loadMore fires from page:1 → nextPage=2, awaits.
        let resolveLoadMore: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockImplementationOnce(
            () => new Promise((r) => { resolveLoadMore = r; }) as any
        );
        const loadMorePromise = (page as any).loadMore();
        await new Promise((r) => setTimeout(r, 0));

        // Concurrent loadData fires and completes, resetting items to a
        // fresh page-1 batch. state.page ends up 1 again.
        vi.mocked(api.listSummaries).mockImplementationOnce(
            async () => ({
                items: Array.from({ length: 20 }, (_, i) => ({
                    task_id: 200 + i,
                    status: TaskStatus.COMPLETED,
                    topic: `fresh-${i}`,
                })),
                total: 40,
            } as any)
        );
        await (page as any).loadData();

        // Stale page-2 response arrives. prev.page is 1 (matching nextPage-1),
        // so the old guard would have appended. loadDataSeq guard catches it.
        resolveLoadMore({
            items: Array.from({ length: 20 }, (_, i) => ({
                task_id: 21 + i,
                status: TaskStatus.COMPLETED,
                topic: `stale-page2-${i}`,
            })),
            total: 40,
        });
        await loadMorePromise;

        const items = (page.state as any).items;
        expect(items).toHaveLength(20);
        expect((page.state as any).page).toBe(1);
        expect(items.every((x: any) => !String(x.topic).startsWith('stale-page2'))).toBe(true);
    });

    /**
     * P1-2 regression (round-7 Jerry-Xin / yujiawei): a failed silent
     * refresh must NOT leave state.page reset to 1 with items still at the
     * old depth. loadData now defers the page/hasMore reset to the success
     * commit, so a failure preserves whatever cursor the user had before.
     */
    it('preserves pagination cursor when a silent refresh fails at deep scroll', async () => {
        const { page } = makePage(
            Array.from({ length: 100 }, (_, i) => ({
                task_id: i + 1,
                status: TaskStatus.COMPLETED,
                topic: `t${i + 1}`,
            }))
        );
        (page as any).state = {
            ...(page as any).state,
            page: 5,
            pageSize: 20,
            hasMore: true,
            total: 200,
        };

        vi.mocked(api.listSummaries).mockRejectedValue(new Error('network'));

        await (page as any).refreshListSilently();

        // items unchanged, page NOT reset, hasMore preserved → next loadMore
        // requests page 6, not page 2, so no rows duplicate.
        const items = (page.state as any).items;
        expect(items).toHaveLength(100);
        expect((page.state as any).page).toBe(5);
        expect((page.state as any).hasMore).toBe(true);
        expect((page.state as any).error).toBeFalsy();
        expect((page.state as any).loading).toBe(false);
    });

    /**
     * Background refresh in flight, user changes filter and a fresh loadData
     * user then changes the status filter, the newer filter-triggered
     * loadData must win — the older refresh response must be discarded
     * rather than overwriting the user's newer view. loadDataSeq is the
     * generation counter that closes this window.
     */
    it('discards a stale background refresh when a newer user-triggered loadData ran under a different filter', async () => {
        const { page } = makePage([
            { task_id: 1, status: TaskStatus.COMPLETED, topic: 'x' },
        ]);

        // Background refresh's loadData is in flight — hold its response.
        let resolveBackground: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockImplementationOnce(
            () => new Promise((r) => { resolveBackground = r; }) as any
        );
        const refreshPromise = (page as any).refreshListSilently();
        await new Promise((r) => setTimeout(r, 0));

        // User changes the filter; a fresh loadData fires and resolves first.
        vi.mocked(api.listSummaries).mockImplementationOnce(
            async () => ({
                items: [{ task_id: 99, status: TaskStatus.PROCESSING, topic: 'fresh-filter' }],
                total: 1,
            } as any)
        );
        (page as any).state = { ...(page as any).state, statusFilter: TaskStatus.PROCESSING };
        await (page as any).loadData();

        // Fresh state committed.
        expect((page.state as any).items).toEqual([
            expect.objectContaining({ task_id: 99, topic: 'fresh-filter' }),
        ]);

        // Now the stale background refresh resolves with the old scope's
        // response. loadDataSeq advanced → this response must be dropped.
        resolveBackground({
            items: [
                { task_id: 1, status: TaskStatus.COMPLETED, topic: 'stale-1' },
                { task_id: 2, status: TaskStatus.COMPLETED, topic: 'stale-2' },
            ],
            total: 999,
        });
        await refreshPromise;

        // Items must still reflect the newer filter's response, not the
        // stale background one.
        expect((page.state as any).items).toEqual([
            expect.objectContaining({ task_id: 99, topic: 'fresh-filter' }),
        ]);
        expect((page.state as any).total).toBe(1);
    });

    /**
     * Round-8 P1 regression (Jerry-Xin / yujiawei): the loadDataSeq guard
     * alone was asymmetric. When loadData starts first and its
     * setState({ loading: true }) is enqueued but not yet committed
     * (React 18 batching from a promise continuation), a concurrent scroll
     * fires loadMore which reads state.loading === false, captures the
     * already-bumped seq, requests a deep page. loadData resolves first
     * (page 1, 20 rows). loadMore's stale deep page resolves — seq matches
     * → appended. Rows in between stranded.
     *
     * Fix: synchronous this.isLoadingData flag, checked in loadMore's entry
     * guard alongside state.loading — closes the deferred-commit window
     * regardless of React batching.
     */
    it('does not fire loadMore while loadData is in flight (isLoadingData sync flag)', async () => {
        const { page } = makePage(
            Array.from({ length: 100 }, (_, i) => ({
                task_id: i + 1,
                status: TaskStatus.COMPLETED,
                topic: `t${i + 1}`,
            }))
        );
        (page as any).state = {
            ...(page as any).state,
            page: 5,
            pageSize: 20,
            hasMore: true,
        };

        // loadData starts and awaits, but its setState is not observably
        // committed yet (mimicking React 18 batching from a promise
        // continuation).
        let resolveLoadData: (v: any) => void = () => {};
        vi.mocked(api.listSummaries).mockImplementationOnce(
            () => new Promise((r) => { resolveLoadData = r; }) as any
        );
        const loadDataPromise = (page as any).loadData({ silent: true });
        await new Promise((r) => setTimeout(r, 0));

        // Simulate the race: state.loading is not yet true (as would happen
        // in React 18 with deferred commit — reset it as if the setState
        // hadn't landed). isLoadingData must still guard.
        (page as any).state = { ...(page as any).state, loading: false };

        // Now a scroll fires loadMore. It must NOT fire a request.
        vi.mocked(api.listSummaries).mockClear();
        const secondCallSpy = vi.fn();
        vi.mocked(api.listSummaries).mockImplementation(secondCallSpy as any);

        await (page as any).loadMore();

        expect(secondCallSpy).not.toHaveBeenCalled();
        expect((page.state as any).loadingMore).toBe(false);

        // Cleanup.
        resolveLoadData({ items: [], total: 0 });
        await loadDataPromise;
    });

    /**
     * Round-9 P1 regression (yujiawei): the terminal branch used to pre-patch
     * items to COMPLETED before firing the refresh. If the refresh failed,
     * items would already show all tasks as terminal → next poll tick sees
     * currentActiveIds=[] → stopBatchPoll → the task keeps its stale title
     * indefinitely with no auto-recovery.
     *
     * Fix: remove the local patch. Now items keep the non-terminal status
     * across the failed refresh, so the next poll tick still detects the
     * status change and re-fires the refresh, giving natural retry.
     */
    it('retries the refresh on the next poll tick when the first attempt fails', async () => {
        const { page } = makePage([
            { task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' },
        ]);

        // batchStatus keeps reporting COMPLETED across ticks.
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);

        // First refresh fails; second succeeds.
        vi.mocked(api.listSummaries)
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce({
                items: [{ task_id: 1, status: TaskStatus.COMPLETED, topic: 'fresh' }],
                total: 1,
            } as any);

        // Tick 1: refresh fails. items is untouched (no local patch since
        // round-9), so the task still shows PROCESSING.
        await (page as any).doBatchPoll([1]);
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }
        expect((page.state as any).items[0].status).toBe(TaskStatus.PROCESSING);
        expect((page.state as any).items[0].topic).toBe('x');

        // Tick 2: batchStatus reports COMPLETED again → change still detected
        // → refresh fires again → succeeds.
        await (page as any).doBatchPoll([1]);
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }
        expect((page.state as any).items[0]).toMatchObject({
            status: TaskStatus.COMPLETED,
            topic: 'fresh',
        });
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
    });
});
