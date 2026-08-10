import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { DriveEntry, FileType } from '../bridge/types';
import { Toast } from '../utils/toast';

/**
 * One-shot listing size. Pagination was tried in earlier revisions of this
 * PR and produced a state-machine complexity spiral (see PR #1285 rounds
 * 8-10): the reload / loadMore / retry / setFilter entries interleaved
 * with abort / seq / context guards in enough ways that every fix
 * unlocked the next race. Reverted to a single 200-row fetch — the same
 * shape the base branch ships — so batch operations can land now, and
 * pagination can come back later in a dedicated PR with a written
 * contract (what "refresh" means for a paged listing, who owns
 * pageIndex, which invocations may cancel which).
 */
const PAGE_SIZE = 200;

/** Client-facing filter — 'all' means no filter is sent to the server. */
export type FileTypeFilter = FileType | 'all';

export interface UseFileListResult {
  entries: DriveEntry[];
  loading: boolean;
  error: string | null;
  /** Server-side total when the listing was capped at PAGE_SIZE, else null. */
  truncatedTotal: number | null;
  reload: () => void;
  filter: FileTypeFilter;
  setFilter: (next: FileTypeFilter) => void;
}

/**
 * Loads the mixed file listing (folders + Type-1 docs + Type-2 blobs) for a
 * space/folder via the unified browse endpoint. Single-shot fetch of up to
 * PAGE_SIZE rows; larger folders surface as a "showing 200 of N" note in
 * the UI (see DriveContent's truncated banner).
 *
 * Reloads on space, folder or filter change. An AbortController drops
 * stale responses so fast navigation (or StrictMode double-mount) can't
 * race an older folder's result onto the current view.
 */
export function useFileList(spaceId: string | null, parentId: number): UseFileListResult {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncatedTotal, setTruncatedTotal] = useState<number | null>(null);
  const [filter, setFilter] = useState<FileTypeFilter>('all');
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    // Abort any in-flight browse FIRST — including on the transition to
    // no-space (DriveVM.reset() sets spaceId null). If we cleared +
    // returned before aborting, the previous space's browse could
    // resolve afterwards and write its (stale, cross-tenant) entries
    // back over the cleared view.
    abortRef.current?.abort();
    const seq = ++seqRef.current;
    if (!spaceId) {
      setEntries([]);
      setTruncatedTotal(null);
      setLoading(false);
      // Clear latched error too — no listing applies to no-space, so
      // any error banner referring to a previous browse is stale.
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await api.browse(
        {
          space_id: spaceId,
          parent_id: parentId,
          type: filter === 'all' ? undefined : filter,
          page_size: PAGE_SIZE,
        },
        ctrl.signal,
      );
      // Generation guard: drop a superseded response (space/folder/
      // filter changed, or reset to no-space) even if its abort didn't
      // land in time.
      if (ctrl.signal.aborted || seq !== seqRef.current) return;
      const list = res.entries ?? [];
      setEntries(list);
      const total = res.page?.total ?? null;
      setTruncatedTotal(total !== null && list.length < total ? total : null);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || seq !== seqRef.current) return;
      const msg = (err as Error)?.message ?? 'load failed';
      setError(msg);
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      if (ctrl.signal.aborted || seq !== seqRef.current) return;
      setLoading(false);
    }
  }, [spaceId, parentId, filter]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const result = useMemo<UseFileListResult>(
    () => ({
      entries,
      loading,
      error,
      truncatedTotal,
      reload,
      filter,
      setFilter,
    }),
    [entries, loading, error, truncatedTotal, reload, filter],
  );
  return result;
}
