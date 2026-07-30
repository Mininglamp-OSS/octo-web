import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  renameFile: vi.fn(),
  moveFolder: vi.fn(),
  moveFile: vi.fn(),
  copyFile: vi.fn(),
  deleteFolder: vi.fn(),
  unmountDoc: vi.fn(),
  deleteBlob: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useDriveOps } from '../useDriveOps';
import type { DriveEntry, FileType } from '../../bridge/types';

function entry(id: number, type: FileType): DriveEntry {
  return {
    id,
    space_id: 'sp',
    parent_id: 1,
    name: `node-${id}`,
    is_folder: type === 'folder',
    type,
    size: 0,
    source: 'user-upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '',
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset?.();
  }
  vi.mocked(api.createFolder).mockResolvedValue({} as never);
  vi.mocked(api.renameFolder).mockResolvedValue(undefined);
  vi.mocked(api.renameFile).mockResolvedValue(undefined);
  vi.mocked(api.moveFolder).mockResolvedValue(undefined);
  vi.mocked(api.moveFile).mockResolvedValue(undefined);
  vi.mocked(api.copyFile).mockResolvedValue({} as never);
  vi.mocked(api.deleteFolder).mockResolvedValue(undefined);
  vi.mocked(api.unmountDoc).mockResolvedValue(undefined);
  vi.mocked(api.deleteBlob).mockResolvedValue(undefined);
});

describe('useDriveOps', () => {
  it('createFolder forwards space/parent/name and returns true', async () => {
    const { result } = renderHook(() => useDriveOps());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.createFolder('sp', 3, 'Reports');
    });
    expect(ok).toBe(true);
    expect(api.createFolder).toHaveBeenCalledWith({ space_id: 'sp', parent_id: 3, name: 'Reports' });
  });

  it('renameEntry dispatches folder→renameFolder, doc/blob→renameFile', async () => {
    const { result } = renderHook(() => useDriveOps());
    await act(async () => {
      await result.current.renameEntry(entry(1, 'folder'), 'X');
      await result.current.renameEntry(entry(2, 'doc'), 'Y');
      await result.current.renameEntry(entry(3, 'blob'), 'Z');
    });
    expect(api.renameFolder).toHaveBeenCalledWith(1, { name: 'X' });
    expect(api.renameFile).toHaveBeenCalledWith(2, { name: 'Y' });
    expect(api.renameFile).toHaveBeenCalledWith(3, { name: 'Z' });
  });

  it('moveEntry dispatches folder→moveFolder, file→moveFile', async () => {
    const { result } = renderHook(() => useDriveOps());
    await act(async () => {
      await result.current.moveEntry(entry(1, 'folder'), 9);
      await result.current.moveEntry(entry(2, 'blob'), 9);
    });
    expect(api.moveFolder).toHaveBeenCalledWith(1, { parent_id: 9 });
    expect(api.moveFile).toHaveBeenCalledWith(2, { parent_id: 9 });
  });

  it('copyEntry always uses copyFile with target parent + name', async () => {
    const { result } = renderHook(() => useDriveOps());
    await act(async () => {
      await result.current.copyEntry(entry(1, 'folder'), 9, 'copy');
    });
    expect(api.copyFile).toHaveBeenCalledWith(1, { parent_id: 9, name: 'copy' });
  });

  it('deleteEntry dispatches folder→deleteFolder, doc→unmountDoc, blob→deleteBlob', async () => {
    const { result } = renderHook(() => useDriveOps());
    await act(async () => {
      await result.current.deleteEntry(entry(1, 'folder'));
      await result.current.deleteEntry(entry(2, 'doc'));
      await result.current.deleteEntry(entry(3, 'blob'));
    });
    expect(api.deleteFolder).toHaveBeenCalledWith(1);
    expect(api.unmountDoc).toHaveBeenCalledWith(2);
    expect(api.deleteBlob).toHaveBeenCalledWith(3);
  });

  it('returns false when the api call throws', async () => {
    vi.mocked(api.deleteBlob).mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useDriveOps());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deleteEntry(entry(3, 'blob'));
    });
    expect(ok).toBe(false);
  });
});
