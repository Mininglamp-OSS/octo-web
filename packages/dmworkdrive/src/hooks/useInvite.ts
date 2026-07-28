import { useState, useCallback, useEffect } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { Invite, DriveRole } from '../bridge/types';
import { Toast } from '../utils/toast';

export interface UseInviteResult {
  invites: Invite[];
  loading: boolean;
  creating: boolean;
  reload: () => void;
  /** Create an invite link for the space. */
  create: (role: DriveRole, expiresInSeconds: number) => Promise<Invite | null>;
  revoke: (inviteId: string) => Promise<boolean>;
  /** Directly add picked org members as space members (no approval). */
  addMembers: (uids: string[], role: DriveRole) => Promise<boolean>;
}

/**
 * Space invite management: link-based invites (create / list / revoke) plus the
 * org-picker path that adds chosen members directly (no approval, P1 v4).
 *
 * Fetches invites only while `enabled` (modal open). addMembers tolerates
 * partial failure — it reports how many of N succeeded rather than aborting on
 * the first duplicate/permission error.
 */
export function useInvite(spaceId: string | null, enabled: boolean): UseInviteResult {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !spaceId) {
      setInvites([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setInvites(await api.listInvites(spaceId));
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t('drive.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [enabled, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (role: DriveRole, expiresInSeconds: number): Promise<Invite | null> => {
      if (!spaceId) return null;
      setCreating(true);
      try {
        const invite = await api.createInvite(spaceId, { role, expires_in_seconds: expiresInSeconds });
        setInvites((prev) => [invite, ...prev]);
        Toast.success(t('drive.invite.created'));
        return invite;
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
        return null;
      } finally {
        setCreating(false);
      }
    },
    [spaceId],
  );

  const revoke = useCallback(
    async (inviteId: string): Promise<boolean> => {
      if (!spaceId) return false;
      try {
        await api.revokeInvite(spaceId, inviteId);
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
        Toast.success(t('drive.invite.revoked'));
        return true;
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
        return false;
      }
    },
    [spaceId],
  );

  const addMembers = useCallback(
    async (uids: string[], role: DriveRole): Promise<boolean> => {
      if (!spaceId || uids.length === 0) return false;
      const results = await Promise.all(
        uids.map((uid) =>
          api
            .addMember(spaceId, { uid, role })
            .then(() => true)
            .catch(() => false),
        ),
      );
      const ok = results.filter(Boolean).length;
      if (ok === uids.length) {
        Toast.success(t('drive.invite.added'));
        return true;
      }
      if (ok === 0) {
        Toast.error(t('drive.toast.opFailed'));
        return false;
      }
      Toast.error(`${t('drive.invite.addedPartial')} ${ok}/${uids.length}`);
      return true;
    },
    [spaceId],
  );

  return { invites, loading, creating, reload: load, create, revoke, addMembers };
}
