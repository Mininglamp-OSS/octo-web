import { useState, useCallback } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { DriveEntry } from '../bridge/types';
import { Toast } from '../utils/toast';

export interface DriveOps {
  busy: boolean;
  createFolder: (spaceId: string, parentId: number, name: string) => Promise<boolean>;
  renameEntry: (entry: DriveEntry, name: string) => Promise<boolean>;
  moveEntry: (entry: DriveEntry, targetParentId: number, opts?: OpOptions) => Promise<boolean>;
  copyEntry: (entry: DriveEntry, targetParentId: number, name: string, opts?: OpOptions) => Promise<boolean>;
  deleteEntry: (entry: DriveEntry, opts?: OpOptions) => Promise<boolean>;
}

/**
 * Per-op options. `silent: true` suppresses the per-op success/error toast so
 * batch callers can aggregate results into a single summary — they still get
 * a boolean return, they just don't spam N toasts for an N-item batch.
 * Default behaviour (silent unset / false) is unchanged: single-row menus
 * still see individual toasts.
 */
export interface OpOptions {
  silent?: boolean;
}

/**
 * File/folder mutations for the drive browser.
 *
 * The backend splits operations by node kind: folders use the /folders/*
 * endpoints; docs and blobs share the generic /files/* ops for rename/move/copy
 * but diverge on delete (docs unmount, blobs hard-delete). This hook hides that
 * dispatch behind entry-typed methods, surfaces a shared `busy` flag, and turns
 * outcomes into toasts + a boolean (true = ok) so callers avoid try/catch.
 */
export function useDriveOps(): DriveOps {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successKey: string, opts?: OpOptions): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        if (!opts?.silent) Toast.success(t(successKey));
        return true;
      } catch (err: unknown) {
        if (!opts?.silent) Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
        // Rethrow when silent so the batch caller (runBatch) can capture the
        // real error message for its aggregated failure list — the caller
        // suppresses per-op toasts precisely to render a single summary.
        if (opts?.silent) throw err;
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const createFolder = useCallback(
    (spaceId: string, parentId: number, name: string) =>
      run(() => api.createFolder({ space_id: spaceId, parent_id: parentId, name }), 'drive.toast.created'),
    [run],
  );

  const renameEntry = useCallback(
    (entry: DriveEntry, name: string) =>
      run(
        () => (entry.type === 'folder' ? api.renameFolder(entry.id, { name }) : api.renameFile(entry.id, { name })),
        'drive.toast.renamed',
      ),
    [run],
  );

  const moveEntry = useCallback(
    (entry: DriveEntry, targetParentId: number, opts?: OpOptions) =>
      run(
        () =>
          entry.type === 'folder'
            ? api.moveFolder(entry.id, { parent_id: targetParentId })
            : api.moveFile(entry.id, { parent_id: targetParentId }),
        'drive.toast.moved',
        opts,
      ),
    [run],
  );

  const copyEntry = useCallback(
    (entry: DriveEntry, targetParentId: number, name: string, opts?: OpOptions) =>
      run(() => api.copyFile(entry.id, { parent_id: targetParentId, name }), 'drive.toast.copied', opts),
    [run],
  );

  const deleteEntry = useCallback(
    (entry: DriveEntry, opts?: OpOptions) =>
      run(
        () => {
          if (entry.type === 'folder') return api.deleteFolder(entry.id);
          if (entry.type === 'doc') return api.unmountDoc(entry.id);
          return api.deleteBlob(entry.id);
        },
        'drive.toast.deleted',
        opts,
      ),
    [run],
  );

  return { busy, createFolder, renameEntry, moveEntry, copyEntry, deleteEntry };
}
