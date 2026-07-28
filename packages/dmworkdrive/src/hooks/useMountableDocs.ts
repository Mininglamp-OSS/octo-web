import { useState, useCallback, useEffect, useRef } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { MountableDoc } from '../bridge/types';
import { Toast } from '../utils/toast';

/** One page covers P1 candidate listing; pagination UI lands later. */
const PAGE_SIZE = 200;

export interface UseMountableDocsResult {
  docs: MountableDoc[];
  loading: boolean;
  error: string | null;
  mounting: boolean;
  reload: () => void;
  /** Mount a candidate into the current space/folder. Drops it from the list on success. */
  mount: (doc: MountableDoc) => Promise<boolean>;
}

/**
 * Loads the docs the user may hand-mount into a space (owner or member of, not
 * already mounted here) via GET /mountable-docs, and mounts a chosen one.
 *
 * Fetches only while `enabled` (the modal is open) so a closed modal never hits
 * the docs-backend reader. An AbortController drops stale responses across
 * space switches / reopen.
 */
export function useMountableDocs(
  spaceId: string | null,
  parentId: number,
  enabled: boolean,
): UseMountableDocsResult {
  const [docs, setDocs] = useState<MountableDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounting, setMounting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !spaceId) {
      setDocs([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMountableDocs({ space_id: spaceId, page_size: PAGE_SIZE }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setDocs(res.items ?? []);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      setError((err as Error)?.message ?? 'load failed');
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [enabled, spaceId, parentId]);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const mount = useCallback(
    async (doc: MountableDoc): Promise<boolean> => {
      if (!spaceId) return false;
      setMounting(true);
      try {
        await api.mountDoc({
          space_id: spaceId,
          parent_id: parentId,
          doc_id: doc.doc_id,
          doc_title: doc.title,
        });
        setDocs((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));
        Toast.success(t('drive.mount.mounted'));
        return true;
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
        return false;
      } finally {
        setMounting(false);
      }
    },
    [spaceId, parentId],
  );

  return { docs, loading, error, mounting, reload: load, mount };
}
