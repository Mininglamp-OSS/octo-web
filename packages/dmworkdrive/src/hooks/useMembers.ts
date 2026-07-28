import { useState, useCallback, useEffect, useMemo } from 'react';
import { WKApp, t } from '@octo/base';
import * as api from '../api/driveApi';
import type { Member, DriveRole } from '../bridge/types';
import { ROLE_RANK } from '../utils/roleLabel';
import { Toast } from '../utils/toast';

export interface UseMembersResult {
  members: Member[];
  loading: boolean;
  /** uid currently being mutated (role change / removal) — disables its row. */
  busyUid: string | null;
  /** Current logged-in user's uid. */
  currentUid: string;
  /** Current user's role in this space (null if not a member / not loaded). */
  myRole: DriveRole | null;
  /** Space creator uid (the fixed super_admin). */
  superAdminUid: string;
  /** downloader+ (rank>=30) — may download blobs and create share links. */
  canDownload: boolean;
  /** uploader_downloader+ (rank>=40) — may upload files. */
  canUpload: boolean;
  /** downloader+ (rank>=30) — may share entries. */
  canShare: boolean;
  /** editor+ (rank>=60) — may mutate structure (folder/mount/rename/move/copy/delete). */
  canEdit: boolean;
  /** admin or super_admin — may change roles / remove members. */
  canManage: boolean;
  /** super_admin only — may grant the admin role (backend-enforced). */
  canGrantAdmin: boolean;
  reload: () => void;
  updateRole: (uid: string, role: DriveRole) => Promise<boolean>;
  remove: (uid: string) => Promise<boolean>;
}

/**
 * Shared-space member management: list members and (for admin+) change roles or
 * remove members. Permission gating is derived client-side — the drive member
 * DTO carries no display fields, so the current user's role is resolved by
 * matching their uid against the member list, and the space creator is the
 * member holding the super_admin role.
 *
 * Fetches only while `enabled` (the panel is open).
 */
export function useMembers(spaceId: string | null, enabled: boolean): UseMembersResult {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const currentUid = WKApp.loginInfo.uid ?? '';

  const load = useCallback(async () => {
    if (!enabled || !spaceId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setMembers(await api.listMembers(spaceId));
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t('drive.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [enabled, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const superAdminUid = useMemo(
    () => members.find((m) => m.role === 'super_admin')?.uid ?? '',
    [members],
  );
  const myRole = useMemo(
    () => members.find((m) => m.uid === currentUid)?.role ?? null,
    [members, currentUid],
  );
  // Rank-gated capabilities, mirroring the backend role ranks (see ROLE_RANK).
  // Callers grant personal-space owners full access separately — this reflects
  // only the current user's shared-space membership role.
  const rank = myRole ? ROLE_RANK[myRole] : 0;
  const canDownload = rank >= ROLE_RANK.downloader;
  const canShare = rank >= ROLE_RANK.downloader;
  const canUpload = rank >= ROLE_RANK.uploader_downloader;
  const canEdit = rank >= ROLE_RANK.editor;
  const canManage = rank >= ROLE_RANK.admin;
  const canGrantAdmin = myRole === 'super_admin';

  const updateRole = useCallback(
    async (uid: string, role: DriveRole): Promise<boolean> => {
      if (!spaceId) return false;
      setBusyUid(uid);
      try {
        await api.updateMemberRole(spaceId, uid, { role });
        setMembers((prev) => prev.map((m) => (m.uid === uid ? { ...m, role } : m)));
        Toast.success(t('drive.member.roleUpdated'));
        return true;
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.member.updateFailed'));
        return false;
      } finally {
        setBusyUid(null);
      }
    },
    [spaceId],
  );

  const remove = useCallback(
    async (uid: string): Promise<boolean> => {
      if (!spaceId) return false;
      setBusyUid(uid);
      try {
        await api.removeMember(spaceId, uid);
        setMembers((prev) => prev.filter((m) => m.uid !== uid));
        Toast.success(t('drive.member.removed'));
        return true;
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.member.removeFailed'));
        return false;
      } finally {
        setBusyUid(null);
      }
    },
    [spaceId],
  );

  return {
    members,
    loading,
    busyUid,
    currentUid,
    myRole,
    superAdminUid,
    canDownload,
    canUpload,
    canShare,
    canEdit,
    canManage,
    canGrantAdmin,
    reload: load,
    updateRole,
    remove,
  };
}
