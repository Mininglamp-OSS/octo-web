import { useState, useCallback } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import type { DriveEntry } from '../bridge/types';
import { Toast } from '../utils/toast';

export interface DriveOps {
  busy: boolean;
  createFolder: (spaceId: string, parentId: number, name: string) => Promise<boolean>;
  renameEntry: (entry: DriveEntry, name: string) => Promise<boolean>;
  moveEntry: (entry: DriveEntry, targetParentId: number) => Promise<boolean>;
  copyEntry: (entry: DriveEntry, targetParentId: number, name: string) => Promise<boolean>;
  deleteEntry: (entry: DriveEntry) => Promise<boolean>;
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

  const run = useCallback(async (fn: () => Promise<unknown>, successKey: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      Toast.success(t(successKey));
      return true;
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

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
    (entry: DriveEntry, targetParentId: number) =>
      run(
        () =>
          entry.type === 'folder'
            ? api.moveFolder(entry.id, { parent_id: targetParentId })
            : api.moveFile(entry.id, { parent_id: targetParentId }),
        'drive.toast.moved',
      ),
    [run],
  );

  const copyEntry = useCallback(
    (entry: DriveEntry, targetParentId: number, name: string) =>
      run(() => api.copyFile(entry.id, { parent_id: targetParentId, name }), 'drive.toast.copied'),
    [run],
  );

  const deleteEntry = useCallback(
    (entry: DriveEntry) =>
      run(() => {
        if (entry.type === 'folder') return api.deleteFolder(entry.id);
        if (entry.type === 'doc') return api.unmountDoc(entry.id);
        return api.deleteBlob(entry.id);
      }, 'drive.toast.deleted'),
    [run],
  );

  return { busy, createFolder, renameEntry, moveEntry, copyEntry, deleteEntry };
}
