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
  // Cumulative loaded count across appended pages. Kept in a ref (not
  // derived from entries.length inside the runFetch closure) because that
  // closure is memoized on [spaceId, parentId, filter] and would otherwise
  // read a frozen 0 after the initial reset. loadedCountRef is written
  // synchronously alongside setEntries so the next runFetch call sees an
  // up-to-date total.
  const loadedCountRef = useRef(0);

  const runFetch = useCallback(
    async (opts: { page: number; append: boolean }) => {
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
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      // A fresh page-1 fetch clears any prior loadMore-error so paging is
      // re-armed on navigation/filter change or explicit reload().
      if (!opts.append) setLoadMoreError(null);
      try {
        const res = await api.browse(
          {
            space_id: spaceId,
            parent_id: parentId,
            type: filter === 'all' ? undefined : filter,
            page_index: opts.page,
            page_size: PAGE_SIZE,
          },
          ctrl.signal,
        );
        if (ctrl.signal.aborted || seq !== seqRef.current) return;
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
        const short = list.length < PAGE_SIZE;
        const reachedTotal =
          nextTotal !== null && loadedCountRef.current >= nextTotal;
        setHasMore(!short && !reachedTotal);
        setPageIndex(opts.page);
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
    void runFetch({ page: 1, append: false });
  }, [runFetch]);

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

  // Fresh page-1 fetch whenever the space, folder or filter changes.
  useEffect(() => {
    void runFetch({ page: 1, append: false });
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
