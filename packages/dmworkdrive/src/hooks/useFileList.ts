import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { DriveEntry, FileType } from '../bridge/types';
import { Toast } from '../utils/toast';

/**
 * Page size for one browse round-trip. The listing pages in incrementally
 * (loadMore appends the next page), so this cap is per-request, not per-view.
 * Smaller pages give a snappier first paint and let the empty-state /
 * folder header render fast; loadMore fills in the rest.
 */
export const PAGE_SIZE = 50;

/** Client-facing filter — 'all' means no filter is sent to the server. */
export type FileTypeFilter = FileType | 'all';

export interface UseFileListResult {
  entries: DriveEntry[];
  /** Loading is true only for the FIRST page fetch of the current view. */
  loading: boolean;
  /** loadingMore is true while a subsequent page is being appended. */
  loadingMore: boolean;
  error: string | null;
  /**
   * Error captured during the last appended fetch (loadMore). While this is
   * non-null the sentinel is expected to hide and `loadMore()` is a no-op —
   * a bare failure would otherwise loop with IntersectionObserver as it re-
   * fires the moment loadingMore flips false and the still-visible sentinel
   * intersects. The user recovers via retryLoadMore() (or a fresh navigation
   * that triggers reload()).
   */
  loadMoreError: string | null;
  /** Total count reported by the last browse response, or null when unknown. */
  total: number | null;
  /** True when more pages are available for the current filter. */
  hasMore: boolean;
  /** Re-fetches from page 1 for the current filter. */
  reload: () => void;
  /** Fetches and appends the next page. No-op when !hasMore or already loading. */
  loadMore: () => void;
  /**
   * Explicit user-triggered retry after a loadMore failure. Clears the
   * error state and re-tries the SAME page (pageIndex+1) — a bare
   * `loadMore()` won't run while loadMoreError is set, so the retry has
   * to go through this path.
   */
  retryLoadMore: () => void;
  /** Current filter; changing it triggers a fresh page-1 fetch. */
  filter: FileTypeFilter;
  setFilter: (next: FileTypeFilter) => void;
}

/**
 * Loads the mixed file listing (folders + Type-1 docs + Type-2 blobs) for a
 * space/folder via the unified browse endpoint. Now paginated: the initial
 * fetch loads page 1 (PAGE_SIZE rows) and loadMore() appends subsequent
 * pages until the server reports fewer rows than requested (or `total` is
 * reached), at which point hasMore flips false.
 *
 * Reloads on space, folder or filter change. An AbortController drops stale
 * responses so fast navigation (or StrictMode double-mount) can't race an
 * older folder's result onto the current view.
 */
export function useFileList(spaceId: string | null, parentId: number): UseFileListResult {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(1);
  const [filter, setFilter] = useState<FileTypeFilter>('all');
  const [hasMore, setHasMore] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  // Live-context ref: kept in sync with the current (spaceId, parentId,
  // filter) every render. runFetch reads this at RESOLVE time (after the
  // await), NOT the closure-captured values, so a stale reload() call
  // whose enclosing scope was bound to a previous space can't win the
  // sequence race and write the previous space's entries into the
  // current space's view. Bot review yujiawei P1-2 caught the specific
  // scenario: mid-batch-delete space switch → the batch's onOk called
  // the render-time reload() (space A) after the user picked space B,
  // and its refetch overwrote space B's list with space A's entries.
  //
  // This is defence at the setEntries boundary — abortRef+seqRef stop
  // the previous space's fetch from writing, but a stale reload() call
  // starts a NEW fetch under a NEW seq that would pass the seq gate.
  // The context check catches that.
  const contextRef = useRef({ spaceId, parentId, filter: 'all' as FileTypeFilter });
  // Cumulative loaded count across appended pages. Kept in a ref (not
  // derived from entries.length inside the runFetch closure) because that
  // closure is memoized on [spaceId, parentId, filter] and would otherwise
  // read a frozen 0 after the initial reset. loadedCountRef is written
  // synchronously alongside setEntries so the next runFetch call sees an
  // up-to-date total.
  const loadedCountRef = useRef(0);

  const runFetch = useCallback(
    async (opts: {
      page: number;
      /** How many rows to fetch this round. Defaults to PAGE_SIZE. */
      pageSize?: number;
      append: boolean;
      resetView?: boolean;
    }) => {
      // Abort any in-flight browse FIRST — including on the transition to
      // no-space (DriveVM.reset() sets spaceId null). If we cleared +
      // returned before aborting, the previous space's browse could resolve
      // afterwards and write its (stale, cross-tenant) entries back over
      // the cleared view.
      abortRef.current?.abort();
      const seq = ++seqRef.current;
      if (!spaceId) {
        setEntries([]);
        setTotal(null);
        setHasMore(false);
        loadedCountRef.current = 0;
        setLoading(false);
        setLoadingMore(false);
        // Clear any latched error/loadMoreError so a later navigation back
        // into a space doesn't render an error banner for a state that no
        // longer applies (bot review P2-3).
        setError(null);
        setLoadMoreError(null);
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      // On a fresh page-1 fetch that ALSO changes context (space/folder/
      // filter change), clear the previous view synchronously — do NOT
      // leave the old entries on screen while the new context is loading.
      // Bot review caught: filter="all" success → switch to "folder" → 2nd
      // browse rejects → filter="folder" but entries still holds the "all"
      // blob. An editor could then select/delete/move rows that belong to
      // the previous context, believing they belong to the new one.
      //
      // But NOT on a same-context reload() (delete/rename/upload/etc):
      // blanking the whole list to a spinner every time an upload lands is
      // a bad UX regression — a 20-file drop would replace the list with a
      // spinner four times as batches complete. Same-context reloads keep
      // the current entries visible until the fresh response lands.
      if (!opts.append && opts.resetView) {
        setEntries([]);
        setTotal(null);
        setHasMore(false);
        loadedCountRef.current = 0;
        setLoadMoreError(null);
      } else if (!opts.append) {
        // Same-context reload: still clear the latched loadMore error so
        // paging is re-armed, but keep entries visible during the fetch.
        setLoadMoreError(null);
      }
      const pageSize = opts.pageSize ?? PAGE_SIZE;
      try {
        const res = await api.browse(
          {
            space_id: spaceId,
            parent_id: parentId,
            type: filter === 'all' ? undefined : filter,
            page_index: opts.page,
            page_size: pageSize,
          },
          ctrl.signal,
        );
        if (ctrl.signal.aborted || seq !== seqRef.current) return;
        // Post-await context guard: if the (spaceId, parentId, filter)
        // captured in this closure no longer matches the LIVE context
        // (contextRef, updated every render), a stale reload() from a
        // previous space is finishing. Do NOT setEntries — that would
        // write the old space's rows over the current space's view.
        // Bot review yujiawei P1-2.
        if (
          contextRef.current.spaceId !== spaceId ||
          contextRef.current.parentId !== parentId ||
          contextRef.current.filter !== filter
        ) {
          return;
        }
        const list = res.entries ?? [];
        // Update entries AND the cumulative count in lock-step. Read from
        // the ref, not from `entries` state — the closure captured the
        // stale state at deps-change time, so entries.length would be 0
        // for every appended page (breaks total-reached math).
        if (opts.append) {
          setEntries((prev) => [...prev, ...list]);
          loadedCountRef.current += list.length;
        } else {
          setEntries(list);
          loadedCountRef.current = list.length;
        }
        const nextTotal = res.page?.total ?? null;
        setTotal(nextTotal);
        // hasMore: this response returned exactly a full page AND we
        // haven't reached the server-reported total yet. A short page is
        // the deterministic terminator; the total gate protects against
        // one wasted round-trip when total is a clean multiple of
        // PAGE_SIZE.
        //
        // NOTE the ratio here uses `pageSize`, not `PAGE_SIZE`, so a
        // multi-page reload() (span-refetch) that hits the exact tail
        // is still classified as short and terminates paging cleanly.
        const short = list.length < pageSize;
        const reachedTotal =
          nextTotal !== null && loadedCountRef.current >= nextTotal;
        setHasMore(!short && !reachedTotal);
        // pageIndex tracks how many PAGE_SIZE-sized pages have been
        // consumed. On a normal append or a page-1 first fetch this is
        // just `opts.page`. On a SPAN refetch (reload with a jumbo
        // pageSize covering multiple pages of history), map the actual
        // received rows back to page count so loadMore() picks up from
        // the right page number. For a partial tail the ceiling gives
        // the last-partial page; that page number is fine — hasMore is
        // already false by then, so it won't refetch anyway.
        if (opts.pageSize && opts.pageSize > PAGE_SIZE && !opts.append) {
          const pagesCovered = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
          setPageIndex(pagesCovered);
        } else {
          setPageIndex(opts.page);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError' || seq !== seqRef.current) return;
        const msg = (err as Error)?.message ?? 'load failed';
        setError(msg);
        // For an APPEND (loadMore) failure, latch the error so the sentinel
        // hides and loadMore() short-circuits until retryLoadMore() clears
        // it. Without this the IntersectionObserver keeps refiring and
        // spamming toast — a broken page-N request loops indefinitely.
        if (opts.append) setLoadMoreError(msg);
        Toast.error(t('drive.toast.loadFailed'));
      } finally {
        if (ctrl.signal.aborted || seq !== seqRef.current) return;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [spaceId, parentId, filter],
  );

  const reload = useCallback(() => {
    // Same-context refresh (delete / rename / upload / etc). Refetch the
    // ENTIRE span the user has already paged through, in one round-trip,
    // so a `loadMore()`-then-`reload()` doesn't collapse the accumulated
    // pages back to page-1 rows.
    //
    // Bot review yujiawei P1-1: without this a paged-through 180-row
    // folder collapses to 50 after any mutation. useSelection then prunes
    // every id past 50 (visibleEntries dropped 130 rows), silently
    // dropping user selections that were on pages 2-4.
    //
    // Implementation: fetch page 1 with page_size = pageIndex * PAGE_SIZE,
    // so a single response covers everything that was loaded. The server
    // caps `page_size` internally; if it comes back short we still hit
    // the terminator path in runFetch and hasMore flips false correctly.
    const span = Math.max(pageIndex, 1) * PAGE_SIZE;
    void runFetch({ page: 1, pageSize: span, append: false });
    // After the refetch runFetch sets pageIndex to 1 (page: 1). Re-align
    // pageIndex to reflect the multi-page span we just re-loaded so a
    // subsequent loadMore() picks up from the correct page number.
    // (No effect if the span didn't fill; hasMore will be false.)
  }, [runFetch, pageIndex]);

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    if (loading || loadingMore) return;
    // Latched-error gate: a failed loadMore MUST be recovered via
    // retryLoadMore() (or a page-1 reload) — otherwise the still-visible
    // sentinel re-triggers the observer the moment loadingMore flips false.
    if (loadMoreError) return;
    void runFetch({ page: pageIndex + 1, append: true });
  }, [runFetch, pageIndex, hasMore, loading, loadingMore, loadMoreError]);

  const retryLoadMore = useCallback(() => {
    if (!hasMore) return;
    if (loading || loadingMore) return;
    // Clear before the fetch so the state is consistent if the retry
    // succeeds; runFetch's finally does NOT touch loadMoreError on the
    // success path (the append-failure catch sets it, page-1 clears it,
    // append-success just leaves the old value which we've already
    // cleared here).
    setLoadMoreError(null);
    void runFetch({ page: pageIndex + 1, append: true });
  }, [runFetch, pageIndex, hasMore, loading, loadingMore]);

  // Sync contextRef every render so runFetch's post-await guard sees
  // the LIVE context, not whatever this closure was bound to when
  // enclosing scope captured reload/loadMore. Runs before the fetch
  // effect below (both fire on the same commit).
  contextRef.current = { spaceId, parentId, filter };

  // Fresh page-1 fetch whenever the space, folder or filter changes.
  // This is the ONLY caller that passes resetView: true, because it's the
  // only path where the previous view no longer represents the current
  // context. reload() (delete/rename/upload/etc) is same-context and
  // preserves entries during the fetch.
  useEffect(() => {
    void runFetch({ page: 1, append: false, resetView: true });
    return () => {
      abortRef.current?.abort();
    };
  }, [runFetch]);

  const result = useMemo<UseFileListResult>(
    () => ({
      entries,
      loading,
      loadingMore,
      error,
      loadMoreError,
      total,
      hasMore,
      reload,
      loadMore,
      retryLoadMore,
      filter,
      setFilter,
    }),
    [entries, loading, loadingMore, error, loadMoreError, total, hasMore, reload, loadMore, retryLoadMore, filter],
  );
  return result;
}
