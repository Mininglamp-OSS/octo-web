import { useState, useCallback, useEffect, useRef } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { DriveEntry } from '../bridge/types';
import { Toast } from '../utils/toast';

/** One page is plenty for P1 folder browsing; pagination UI lands later. */
const PAGE_SIZE = 200;

export interface UseFileListResult {
  entries: DriveEntry[];
  loading: boolean;
  error: string | null;
  /** Server-side total when the listing was capped at PAGE_SIZE, else null. */
  truncatedTotal: number | null;
  reload: () => void;
}

/**
 * Loads the mixed file listing (folders + Type-1 docs + Type-2 blobs) for a
 * space/folder via the unified browse endpoint.
 *
 * Reloads on space or folder change. An AbortController drops stale responses
 * so fast navigation (or StrictMode double-mount) can't race an older folder's
 * result onto the current view.
 */
export function useFileList(spaceId: string | null, parentId: number): UseFileListResult {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncatedTotal, setTruncatedTotal] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    // Abort any in-flight browse FIRST — including on the transition to no-space
    // (DriveVM.reset() sets spaceId null). If we cleared + returned before
    // aborting, the previous space's browse could resolve afterwards and write
    // its (stale, cross-tenant) entries back over the cleared view.
    abortRef.current?.abort();
    const seq = ++seqRef.current;
    if (!spaceId) {
      setEntries([]);
      setTruncatedTotal(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await api.browse(
        { space_id: spaceId, parent_id: parentId, page_size: PAGE_SIZE },
        ctrl.signal,
      );
      // Generation guard: drop a superseded response (space/folder changed, or
      // reset to no-space) even if its abort didn't land in time.
      if (ctrl.signal.aborted || seq !== seqRef.current) return;
      const list = res.entries ?? [];
      setEntries(list);
      // P1 fetches a single page; surface a notice when the server has more so
      // the capped listing doesn't silently read as "the whole folder".
      const total = res.page?.total ?? list.length;
      setTruncatedTotal(total > list.length ? total : null);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || seq !== seqRef.current) return;
      setError((err as Error)?.message ?? 'load failed');
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      if (!ctrl.signal.aborted && seq === seqRef.current) setLoading(false);
    }
  }, [spaceId, parentId]);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  return { entries, loading, error, truncatedTotal, reload: load };
}
