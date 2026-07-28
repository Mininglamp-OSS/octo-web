import { useState, useCallback, useEffect } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { Share, SharePermission } from '../bridge/types';
import { Toast } from '../utils/toast';

export interface UseShareResult {
  /** Existing shares for the target file (backend lists all; filtered here). */
  shares: Share[];
  loading: boolean;
  creating: boolean;
  reload: () => void;
  create: (
    permission: SharePermission,
    expiresInSeconds: number,
    password?: string,
  ) => Promise<Share | null>;
  /**
   * Reuse the file's existing valid download link, or mint a permanent one.
   * WeCom-style one-shot sharing: one download link per file, no options.
   */
  ensure: () => Promise<Share | null>;
  revoke: (shareId: string) => Promise<boolean>;
}

/**
 * Effectively-permanent expiry (~100y) for one-shot WeCom-style links. The
 * drive backend treats `expires_in_seconds <= 0` as "use the default expiry"
 * (not permanent) and always stamps a non-nil ExpiresAt on create, so the
 * frontend requests a far-future expiry to approximate a permanent link
 * without a backend change. (A cleaner backend option — map `<0` → nil
 * ExpiresAt, which the access path already treats as no-expiry — is deferred.)
 */
const PERMANENT_EXPIRY_SECONDS = 100 * 365 * 86400;

function isExpired(s: Share): boolean {
  return !!s.expires_at && new Date(s.expires_at).getTime() <= Date.now();
}

/**
 * Manages share links for one file: lists existing shares (the backend list
 * endpoint returns the caller's shares across all files, so it's filtered to
 * `fileId` here), creates new ones, and revokes.
 *
 * Fetches only while `enabled` (modal open). P1 permissions are view/download
 * only (edit is backend-P2); callers must not offer edit.
 */
export function useShare(fileId: number | null, enabled: boolean): UseShareResult {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || fileId == null) {
      setShares([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const all = await api.listShares();
      setShares(all.filter((s) => s.file_id === fileId));
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t('drive.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [enabled, fileId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (
      permission: SharePermission,
      expiresInSeconds: number,
      password?: string,
    ): Promise<Share | null> => {
      if (fileId == null) return null;
      setCreating(true);
      try {
        const share = await api.createShare({
          file_id: fileId,
          permission,
          expires_in_seconds: expiresInSeconds,
          password: password || undefined,
        });
        setShares((prev) => [share, ...prev]);
        Toast.success(t('drive.share.created'));
        return share;
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
        return null;
      } finally {
        setCreating(false);
      }
    },
    [fileId],
  );

  const ensure = useCallback(async (): Promise<Share | null> => {
    if (fileId == null) return null;
    setCreating(true);
    try {
      // Reuse an existing, still-valid download link (one link per file);
      // otherwise mint a permanent one.
      const all = await api.listShares();
      const existing = all.find(
        (s) => s.file_id === fileId && s.permission === 'download' && !isExpired(s),
      );
      if (existing) return existing;
      return await api.createShare({
        file_id: fileId,
        permission: 'download',
        expires_in_seconds: PERMANENT_EXPIRY_SECONDS,
      });
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
      return null;
    } finally {
      setCreating(false);
    }
  }, [fileId]);

  const revoke = useCallback(async (shareId: string): Promise<boolean> => {
    try {
      await api.revokeShare(shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      Toast.success(t('drive.share.revoked'));
      return true;
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
      return false;
    }
  }, []);

  return { shares, loading, creating, reload: load, create, ensure, revoke };
}
