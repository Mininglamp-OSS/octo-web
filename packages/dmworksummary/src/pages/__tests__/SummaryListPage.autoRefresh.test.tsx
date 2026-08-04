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

    it('silently reloads the full list AND applies the local status patch immediately when a task reaches a terminal status', async () => {
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

        // The confirmed terminal status must be applied locally BEFORE the
        // async refresh lands, so the card does not render a stale PROCESSING
        // status (with Cancel affordance) for the round-trip window.
        const firstPatch = setStatePatches[0];
        expect(firstPatch).toBeDefined();
        expect((firstPatch as any).items?.[0]).toMatchObject({ status: TaskStatus.COMPLETED });

        // Full list re-fetched (title/preview reflected), not just an
        // in-place status patch.
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
     * When `pageSize * page > 100`, the refresh clamps and returns fewer
     * items than were previously loaded. state.page must be re-anchored so
     * the next loadMore() picks up the row immediately after the refreshed
     * tail — otherwise items in the gap are permanently skipped. This test
     * asserts both the re-anchor AND the observable consequence (next
     * loadMore requests the correct page).
     */
    it('re-anchors state.page after a clamped refresh so the next loadMore() picks up the true tail', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 42, status: TaskStatus.COMPLETED },
        ] as any);
        // Backend caps page_size at 100 — return exactly 100 items but a much
        // larger total so hasMore stays true.
        const refreshedItems = Array.from({ length: 100 }, (_, i) => ({
            task_id: i + 1,
            status: TaskStatus.COMPLETED,
            topic: `t${i + 1}`,
        }));
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: refreshedItems,
            total: 240,
        } as any);

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
        // Only 100 items came back; state.page must be re-anchored to
        // Ceil(100 / 20) = 5 so the next loadMore() requests page 6.
        expect((page.state as any).items).toHaveLength(100);
        expect((page.state as any).page).toBe(5);
        expect((page.state as any).hasMore).toBe(true);

        // Observable consequence: the next loadMore() requests page 6.
        vi.mocked(api.listSummaries).mockClear();
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: Array.from({ length: 20 }, (_, i) => ({
                task_id: i + 101,
                status: TaskStatus.COMPLETED,
                topic: `t${i + 101}`,
            })),
            total: 240,
        } as any);

        await (page as any).loadMore();
        await new Promise((r) => setTimeout(r, 0));

        expect(api.listSummaries).toHaveBeenCalledWith(
            expect.objectContaining({ page: 6, page_size: 20 })
        );
    });

    /**
     * If the user changes the status filter while a refresh is in flight,
     * the refresh must drop its stale response rather than clobbering the
     * newer state.
     */
    it('drops the refresh response if the status filter changed while the fetch was in flight', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);

        let resolveList: (v: any) => void = () => {};
        const listPromise = new Promise((r) => { resolveList = r; });
        vi.mocked(api.listSummaries).mockReturnValue(listPromise as any);

        const { page } = makePage([{ task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' }]);

        const pollPromise = (page as any).doBatchPoll([1]);
        await new Promise((r) => setTimeout(r, 0));

        (page as any).state = { ...(page as any).state, statusFilter: TaskStatus.COMPLETED };
        const filteredItems = [{ task_id: 999, status: TaskStatus.COMPLETED, topic: 'filtered' }];

        resolveList({ items: filteredItems, total: 999 });
        await pollPromise;
        await new Promise((r) => setTimeout(r, 0));

        // The stale response must NOT have overwritten items.
        expect((page.state as any).items).toHaveLength(1);
        expect((page.state as any).items[0].task_id).toBe(1);
        expect((page.state as any).total).not.toBe(999);
    });

    /**
     * If loadMore appends a new page while the silent refresh is in flight,
     * the refresh's response would otherwise clobber the appended items and
     * reset the cursor. The listSeq bump inside loadMore signals the refresh
     * to bail on resume — the appended tail must survive. This is asserted
     * directly against refreshListSilently rather than the full poll flow
     * so promise ordering is deterministic.
     */
    it('drops the refresh response if loadMore bumped listSeq while the fetch was in flight', async () => {
        // 120 items already loaded; state.page = 6, pageSize = 20.
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

        // Fire the refresh directly and don't await.
        const refreshPromise = (page as any).refreshListSilently();
        await new Promise((r) => setTimeout(r, 0));

        // Simulate a concurrent loadMore having landed: it bumps listSeq
        // and mutates state (appends items, advances page).
        (page as any).listSeq++;
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

        // Refresh resolves: its response would reset items to 100 rows and
        // page to 5. The listSeq bump must make it bail.
        resolveRefresh({
            items: Array.from({ length: 100 }, (_, i) => ({
                task_id: i + 1,
                status: TaskStatus.COMPLETED,
                topic: `stale-${i + 1}`,
            })),
            total: 240,
        });
        await refreshPromise;

        // The appended tail must survive: items still 140 rows, page still 7.
        expect((page.state as any).items).toHaveLength(140);
        expect((page.state as any).page).toBe(7);
        expect((page.state as any).items[139].topic).toBe('page7-140');
    });

    /**
     * If the refresh request throws, the local status patch applied before
     * the refresh must survive so the next poll tick does not re-detect the
     * same transition. The refresh's isRefreshing flag must also be reset
     * so the next poll can retry.
     */
    it('preserves the local status patch when the refresh request throws', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([
            { id: 1, status: TaskStatus.COMPLETED },
        ] as any);
        vi.mocked(api.listSummaries).mockRejectedValue(new Error('refresh failed'));

        const { page } = makePage([{ task_id: 1, status: TaskStatus.PROCESSING, topic: 'x' }]);

        await (page as any).doBatchPoll([1]);
        // Yield until the fire-and-forget refresh's finally block runs.
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }

        // Local patch survived: item is COMPLETED even though refresh threw.
        expect((page.state as any).items[0]).toMatchObject({ status: TaskStatus.COMPLETED });
        // isRefreshing is reset so the next poll tick can try again.
        expect((page as any).isRefreshing).toBe(false);
    });
});
