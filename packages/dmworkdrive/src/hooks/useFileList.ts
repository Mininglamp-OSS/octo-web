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

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  // hasMore is derived from state, but pageIndex + entries change together
  // so we track it explicitly to avoid recomputing during a partially-loaded
  // list where the last response returned < PAGE_SIZE (final page).
  const hasMoreRef = useRef(false);
  const [, forceRerenderHasMore] = useState(0);

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
        hasMoreRef.current = false;
        forceRerenderHasMore((n) => n + 1);
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
        setEntries((prev) => (opts.append ? [...prev, ...list] : list));
        const nextTotal = res.page?.total ?? null;
        setTotal(nextTotal);
        // hasMore: this response returned exactly a full page AND we haven't
        // exceeded the server total yet. A short page is the terminating
        // signal (backend paginates deterministically).
        const loadedAfter = (opts.append ? entries.length : 0) + list.length;
        const short = list.length < PAGE_SIZE;
        const reachedTotal = nextTotal !== null && loadedAfter >= nextTotal;
        hasMoreRef.current = !short && !reachedTotal;
        forceRerenderHasMore((n) => n + 1);
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
    // entries.length is intentional: appended fetches need to know how many
    // rows are already visible to compute hasMore correctly. filter is a
    // separate effect trigger below (via useEffect on filter change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaceId, parentId, filter],
  );

  const reload = useCallback(() => {
    void runFetch({ page: 1, append: false });
  }, [runFetch]);

  const loadMore = useCallback(() => {
    if (!hasMoreRef.current) return;
    if (loading || loadingMore) return;
    void runFetch({ page: pageIndex + 1, append: true });
  }, [runFetch, pageIndex, loading, loadingMore]);

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
      hasMore: hasMoreRef.current,
      reload,
      loadMore,
      filter,
      setFilter,
    }),
    [entries, loading, loadingMore, error, total, reload, loadMore, filter],
  );
  return result;
}
