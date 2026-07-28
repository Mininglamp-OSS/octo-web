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
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await api.browse(
        { space_id: spaceId, parent_id: parentId, page_size: PAGE_SIZE },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      setEntries(res.entries ?? []);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      setError((err as Error)?.message ?? 'load failed');
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [spaceId, parentId]);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  return { entries, loading, error, reload: load };
}
