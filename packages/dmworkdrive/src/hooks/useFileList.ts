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
  /** Total count reported by the last browse response, or null when unknown. */
  total: number | null;
  /** True when more pages are available for the current filter. */
  hasMore: boolean;
  /** Re-fetches from page 1 for the current filter. */
  reload: () => void;
  /** Fetches and appends the next page. No-op when !hasMore or already loading. */
  loadMore: () => void;
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
        setError((err as Error)?.message ?? 'load failed');
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
      total,
      hasMore,
      reload,
      loadMore,
      filter,
      setFilter,
    }),
    [entries, loading, loadingMore, error, total, hasMore, reload, loadMore, filter],
  );
  return result;
}
