import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  browse: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useFileList, PAGE_SIZE } from '../useFileList';
import type { DriveEntry, FileType, BrowseResponse } from '../../bridge/types';

function entry(id: number, name: string, type: FileType): DriveEntry {
  return {
    id,
    space_id: 'sp',
    parent_id: 0,
    name,
    is_folder: type === 'folder',
    type,
    size: type === 'blob' ? 100 : 0,
    source: 'user-upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

function resp(entries: DriveEntry[], total?: number): BrowseResponse {
  return {
    entries,
    page: { page_size: PAGE_SIZE, page_index: 1, total: total ?? entries.length, data: entries },
    filter: { type: 'all', source: 'all' },
  };
}

beforeEach(() => {
  vi.mocked(api.browse).mockReset();
});

describe('useFileList', () => {
  it('does not call browse when spaceId is null', async () => {
    const { result } = renderHook(() => useFileList(null, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(api.browse).not.toHaveBeenCalled();
  });

  it('loads entries for the space/folder with the paginated PAGE_SIZE', async () => {
    vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'docs', 'folder'), entry(2, 'a.pdf', 'blob')]));
    const { result } = renderHook(() => useFileList('sp', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toHaveLength(2);
    expect(api.browse).toHaveBeenCalledWith(
      {
        space_id: 'sp',
        parent_id: 0,
        page_index: 1,
        page_size: PAGE_SIZE,
        type: undefined,
      },
      expect.anything(),
    );
  });

  it('reloads when parentId changes', async () => {
    vi.mocked(api.browse).mockResolvedValue(resp([]));
    const { rerender } = renderHook((props: { p: number }) => useFileList('sp', props.p), {
      p: 0,
    });
    await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(1));

    rerender({ p: 5 });
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ space_id: 'sp', parent_id: 5, page_index: 1 }),
        expect.anything(),
      ),
    );
  });

  it('surfaces an error when browse fails', async () => {
    vi.mocked(api.browse).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useFileList('sp', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('nope');
  });

  it('drops a browse that resolves after the space is reset to null (P0-2 stale leak)', async () => {
    // Space A's browse hangs so we can resolve it out of order.
    let resolveA: (r: BrowseResponse) => void = () => {};
    vi.mocked(api.browse).mockImplementationOnce(
      () => new Promise<BrowseResponse>((res) => { resolveA = res; }),
    );
    const { result, rerender } = renderHook(
      (props: { sp: string | null }) => useFileList(props.sp, 0),
      { sp: 'A' as string | null },
    );
    await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(1));

    // DriveVM.reset() drops the active space → spaceId null. Entries clear.
    rerender({ sp: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);

    // Space A's browse resolves LATE — the null transition aborted it, so it
    // must not write the previous tenant's entries back over the cleared view.
    await act(async () => {
      resolveA(resp([entry(1, 'stale', 'blob')]));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.entries).toEqual([]);
  });

  describe('pagination', () => {
    it('hasMore is true when the first page is full and total > page', async () => {
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      vi.mocked(api.browse).mockResolvedValue(resp(first, PAGE_SIZE * 3));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);
    });

    it('hasMore is false when the first page is shorter than PAGE_SIZE', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'a', 'blob')]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(false);
    });

    it('loadMore appends the next page and increments page_index', async () => {
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      const second = [entry(1000, 'tail', 'blob')];
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(first, PAGE_SIZE + 1))
        .mockResolvedValueOnce({
          entries: second,
          page: { page_size: PAGE_SIZE, page_index: 2, total: PAGE_SIZE + 1, data: second },
          filter: { type: 'all', source: 'all' },
        });
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(PAGE_SIZE);
      expect(result.current.hasMore).toBe(true);

      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
      expect(result.current.entries).toHaveLength(PAGE_SIZE + 1);
      expect(api.browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ page_index: 2 }),
        expect.anything(),
      );
      expect(result.current.hasMore).toBe(false);
    });

    it('loadMore is a no-op when hasMore is false', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'a', 'blob')]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(false);
      const before = vi.mocked(api.browse).mock.calls.length;
      act(() => result.current.loadMore());
      // No additional browse call.
      expect(vi.mocked(api.browse).mock.calls.length).toBe(before);
    });

    it('hasMore flips false via reachedTotal when total is a clean multiple of PAGE_SIZE', async () => {
      // Reviewer-caught regression: previously hasMore stayed true after the
      // last real page when total === N * PAGE_SIZE because the closure
      // frozen `entries.length` was always 0, so reachedTotal never fired.
      // With loadedCountRef tracking cumulative progress, the second full
      // page must correctly report hasMore === false.
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      const second = Array.from({ length: PAGE_SIZE }, (_, i) => entry(1000 + i, `m${i}`, 'blob'));
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(first, PAGE_SIZE * 2))
        .mockResolvedValueOnce({
          entries: second,
          page: { page_size: PAGE_SIZE, page_index: 2, total: PAGE_SIZE * 2, data: second },
          filter: { type: 'all', source: 'all' },
        });
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);

      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
      expect(result.current.entries).toHaveLength(PAGE_SIZE * 2);
      // Cumulative count === total, so reachedTotal trips — no third fetch.
      expect(result.current.hasMore).toBe(false);
    });

    it('latches loadMoreError on append failure and stops loadMore from re-firing', async () => {
      // Bot-review Critical: without a latched error, a failed page-N request
      // would loop forever — IntersectionObserver rebuilds the moment
      // loadingMore flips false and the still-visible sentinel re-triggers
      // onLoadMore, hammering the same broken request and spamming toast.
      //
      // Contract now:
      //   1. Page-1 succeeds with hasMore=true (server total > current load).
      //   2. Page-2 fetch REJECTS -> loadMoreError latches, hasMore stays
      //      true (retry is still possible), pageIndex stays at 1.
      //   3. A subsequent loadMore() is a no-op (does NOT hit the network).
      //   4. Only retryLoadMore() clears the error and re-issues the fetch.
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      const second = Array.from({ length: PAGE_SIZE }, (_, i) => entry(1000 + i, `m${i}`, 'blob'));
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(first, PAGE_SIZE * 3))
        .mockRejectedValueOnce(new Error('network kaboom'))
        .mockResolvedValueOnce({
          entries: second,
          page: { page_size: PAGE_SIZE, page_index: 2, total: PAGE_SIZE * 3, data: second },
          filter: { type: 'all', source: 'all' },
        });
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);
      expect(result.current.loadMoreError).toBeNull();

      // Failing loadMore latches the error.
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
      expect(result.current.loadMoreError).not.toBeNull();
      // hasMore is intentionally still true so retryLoadMore has something to
      // pull; the sentinel + observer are gated on !loadMoreError in the
      // caller (DriveContent), so this doesn't cause a UI loop.
      expect(result.current.hasMore).toBe(true);
      expect(result.current.entries).toHaveLength(PAGE_SIZE);

      // Bare loadMore() must NOT retry — the retry path is explicit.
      const callsAfterFail = vi.mocked(api.browse).mock.calls.length;
      act(() => result.current.loadMore());
      // Still-latched error blocks the call. Wait a tick to confirm nothing
      // fires asynchronously.
      await new Promise((r) => setTimeout(r, 0));
      expect(vi.mocked(api.browse).mock.calls.length).toBe(callsAfterFail);

      // retryLoadMore() clears the error and issues the retry, which now
      // succeeds and appends.
      act(() => result.current.retryLoadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
      expect(result.current.loadMoreError).toBeNull();
      expect(result.current.entries).toHaveLength(PAGE_SIZE * 2);
    });

    it('reload() clears a latched loadMoreError so paging is re-armed', async () => {
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(first, PAGE_SIZE * 3))
        .mockRejectedValueOnce(new Error('network kaboom'))
        .mockResolvedValueOnce(resp(first, PAGE_SIZE * 3));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Trigger the failure so the error latches.
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadMoreError).not.toBeNull());

      // A fresh page-1 reload MUST reset the latched error — otherwise the
      // user is stuck showing the error banner even after navigating away
      // and back (which internally issues a page-1 fetch).
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.loadMoreError).toBeNull();
    });
  });

  describe('type filter', () => {
    it('starts at "all" and passes type=undefined', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.filter).toBe('all');
      expect(api.browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: undefined }),
        expect.anything(),
      );
    });

    it('setFilter triggers a fresh page-1 fetch with the type param', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.setFilter('folder'));
      await waitFor(() =>
        expect(api.browse).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: 'folder', page_index: 1 }),
          expect.anything(),
        ),
      );
    });

    it('clears stale entries synchronously on context change even when the new fetch rejects', async () => {
      // Bot-review P1: filter=all success (1 blob) → switch to filter=folder,
      // that browse rejects → filter is now 'folder' but entries USED TO
      // still hold the 'all' blob, so an editor could act on rows that
      // belong to the previous context. Fix: page-1 fetch must clear
      // entries/total/hasMore synchronously BEFORE awaiting, so a failed
      // context switch surfaces as an empty listing + error, not a phantom
      // listing under the wrong filter.
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp([entry(1, 'a.pdf', 'blob')]))
        .mockRejectedValueOnce(new Error('network kaboom'));

      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.filter).toBe('all');

      // Switch filter — this triggers a new page-1 fetch that will reject.
      act(() => result.current.setFilter('folder'));

      // Wait for the failed fetch to resolve (setLoading back to false).
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Filter is now 'folder' but the failed fetch left an empty listing —
      // NOT the stale [{a.pdf}] from the previous 'all' context.
      expect(result.current.filter).toBe('folder');
      expect(result.current.entries).toHaveLength(0);
      expect(result.current.total).toBeNull();
      expect(result.current.hasMore).toBe(false);
      expect(result.current.error).not.toBeNull();
    });

    it('reload() preserves entries during the fetch (no spinner flash)', async () => {
      // Bot-review P2-3: previously the page-1 clear fired unconditionally
      // for both context changes AND reload(), so every delete/rename/
      // upload landed with a full-list spinner flash before the new rows
      // arrived. A 20-file drag-drop replaced the list with a spinner
      // four times as batches settled. Fix: only clear on context change
      // (resetView: true), not on reload() (same-context refresh).
      const initial = [entry(1, 'a.pdf', 'blob'), entry(2, 'b.pdf', 'blob')];
      const refreshed = [entry(1, 'a.pdf', 'blob'), entry(3, 'c.pdf', 'blob')];
      let resolveRefresh: (v: ReturnType<typeof resp>) => void = () => {};
      const refreshPromise = new Promise<ReturnType<typeof resp>>((r) => {
        resolveRefresh = r;
      });
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(initial))
        .mockReturnValueOnce(refreshPromise);

      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(2);

      // Reload — kicks off the second browse. loading flips true but
      // entries MUST remain visible until the response lands.
      act(() => result.current.reload());
      // Synchronously after reload() the entries should NOT be blanked.
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries[0].id).toBe(1);

      // Now resolve the fetch — entries update to the fresh list.
      resolveRefresh(resp(refreshed));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries.map((e) => e.id)).toEqual([1, 3]);
    });

    it('reload() after loadMore() refetches the FULL span, not just page 1 (P1-1)', async () => {
      // Bot review yujiawei P1-1: a paged-through folder collapsed to
      // page-1 rows after any reload(), silently pruning selections that
      // lived on later pages. Fix: reload() must span the pages the user
      // has already loaded — page_size = pageIndex * PAGE_SIZE — so a
      // single response covers everything.
      const page1 = Array.from({ length: 50 }, (_, i) =>
        entry(i + 1, `f${i + 1}.pdf`, 'blob'),
      );
      const page2 = Array.from({ length: 50 }, (_, i) =>
        entry(i + 51, `f${i + 51}.pdf`, 'blob'),
      );
      const page3Partial = Array.from({ length: 30 }, (_, i) =>
        entry(i + 101, `f${i + 101}.pdf`, 'blob'),
      );
      const refreshedSpan = [...page1, ...page2, ...page3Partial]; // 130 rows
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(page1, 130))
        .mockResolvedValueOnce(resp(page2, 130))
        .mockResolvedValueOnce(resp(page3Partial, 130))
        // reload() should be ONE call with a wide page_size that returns
        // the whole span in one shot.
        .mockResolvedValueOnce(resp(refreshedSpan, 130));

      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(50);

      // Page in to 100 rows.
      await act(async () => {
        result.current.loadMore();
      });
      await waitFor(() => expect(result.current.entries).toHaveLength(100));

      // Page in to 130 rows (short page — hasMore should flip false).
      await act(async () => {
        result.current.loadMore();
      });
      await waitFor(() => expect(result.current.entries).toHaveLength(130));
      expect(result.current.hasMore).toBe(false);

      // Now reload — MUST NOT collapse the 130-row view to 50.
      await act(async () => {
        result.current.reload();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(130);
      // And the fourth browse call was made with a wide page_size (3
      // pages worth = 150), not the default PAGE_SIZE.
      const calls = vi.mocked(api.browse).mock.calls;
      const reloadCall = calls[calls.length - 1]!;
      const params = reloadCall[0] as { page_size: number; page_index: number };
      expect(params.page_index).toBe(1);
      expect(params.page_size).toBeGreaterThan(50);
    });

    it('stale reload() from a previous space cannot overwrite the current view (P1-2)', async () => {
      // Bot review yujiawei P1-2: a reload() closure captured while the
      // user was in space A, invoked AFTER the user has switched to
      // space B (e.g. from a batch delete's onOk running after a
      // sidebar click), would abort space B's browse, pass the seq gate
      // with its own fresh sequence, and write A's entries into B's
      // view. Fix: post-await contextRef guard.
      let resolveAReload: (v: ReturnType<typeof resp>) => void = () => {};
      const aReloadResp = new Promise<ReturnType<typeof resp>>((r) => {
        resolveAReload = r;
      });
      vi.mocked(api.browse).mockImplementation((params) => {
        // Space A: initial load returns 1 row instantly; A's reload is
        // held on aReloadResp so we can resolve it after the switch.
        if (params.space_id === 'sp-A') {
          const calls = vi.mocked(api.browse).mock.calls;
          const aCalls = calls.filter(
            (c) => (c[0] as { space_id: string }).space_id === 'sp-A',
          ).length;
          if (aCalls === 1) return Promise.resolve(resp([entry(1, 'a1.pdf', 'blob')]));
          return aReloadResp;
        }
        // Space B: instant load.
        return Promise.resolve(resp([entry(101, 'b1.pdf', 'blob')]));
      });

      // Start in space A.
      const { result, rerender } = renderHook(
        ({ spaceId }: { spaceId: string }) => useFileList(spaceId, 0),
        { spaceId: 'sp-A' },
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries[0]?.id).toBe(1);

      // Capture the A-bound reload BEFORE the switch, then invoke it.
      // Its browse is stalled on aReloadResp.
      const aReload = result.current.reload;
      act(() => aReload());

      // While A's reload is in flight, switch to space B. useEffect
      // fires a fresh browse for B, which resolves quickly.
      rerender({ spaceId: 'sp-B' });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries[0]?.id).toBe(101);

      // Now let A's reload resolve. Its captured closure has spaceId
      // === 'sp-A', but contextRef.current.spaceId === 'sp-B'. Guard
      // must bail before setEntries.
      await act(async () => {
        resolveAReload(resp([entry(2, 'a2.pdf', 'blob')]));
        await Promise.resolve();
        await Promise.resolve();
      });
      // View must STILL be space B's rows, not space A's.
      expect(result.current.entries[0]?.id).toBe(101);
      expect(result.current.entries).toHaveLength(1);
    });
  });
});
