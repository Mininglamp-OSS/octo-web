import { useState, useCallback, useEffect, useMemo } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { Space, CreateSpaceReq } from '../bridge/types';
import { Toast } from '../utils/toast';

export interface UseSpaceListResult {
  spaces: Space[];
  /** The user's personal space (guaranteed present after a successful load). */
  personalSpace: Space | null;
  sharedSpaces: Space[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Create a shared space, merge it into the list, and return it. Throws on failure. */
  createShared: (name: string) => Promise<Space>;
}

/**
 * Loads the drive space list and guarantees a personal space exists.
 *
 * The backend keeps personal and shared spaces in one list; this hook splits
 * them for the sidebar. If listing returns no personal space, it lazily calls
 * ensurePersonalSpace so a fresh user always lands somewhere.
 */
export function useSpaceList(): UseSpaceListResult {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let list = await api.listSpaces();
      if (!list.some((s) => s.type === 'personal')) {
        const personal = await api.ensurePersonalSpace();
        list = [personal, ...list];
      }
      setSpaces(list);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'load failed');
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createShared = useCallback(async (name: string): Promise<Space> => {
    const req: CreateSpaceReq = { name };
    const space = await api.createSharedSpace(req);
    setSpaces((prev) => [...prev, space]);
    return space;
  }, []);

  const personalSpace = useMemo(
    () => spaces.find((s) => s.type === 'personal') ?? null,
    [spaces],
  );
  const sharedSpaces = useMemo(() => spaces.filter((s) => s.type === 'shared'), [spaces]);

  return { spaces, personalSpace, sharedSpaces, loading, error, reload: load, createShared };
}
