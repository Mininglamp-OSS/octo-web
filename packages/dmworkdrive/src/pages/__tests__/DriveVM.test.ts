import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WKApp } from '@octo/base';
import { waitFor } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listSpaces: vi.fn(),
  ensurePersonalSpace: vi.fn(),
  createSharedSpace: vi.fn(),
  getAncestors: vi.fn(),
}));
vi.mock('../../utils/toast', () => ({ Toast: { success: vi.fn(), error: vi.fn() } }));

import * as api from '../../api/driveApi';
import { DriveVM } from '../DriveVM';
import type { Space } from '../../bridge/types';

function space(id: string, type: 'personal' | 'shared'): Space {
  return {
    id,
    type,
    name: id,
    super_admin_uid: 'sa',
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  };
}

const ME = 'test-uid'; // matches the @octo/base mock's loginInfo.uid

beforeEach(() => {
  vi.mocked(api.listSpaces).mockReset();
  vi.mocked(api.ensurePersonalSpace).mockReset();
  WKApp.loginInfo.uid = ME;
});

afterEach(() => {
  WKApp.loginInfo.uid = ME;
});

describe('DriveVM tenant isolation (PR#1146 review B1)', () => {
  it('ensureLoaded fetches the space list exactly once', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('p', 'personal')]);
    const vm = new DriveVM();
    vm.ensureLoaded();
    vm.ensureLoaded(); // second mount must not re-fetch
    await waitFor(() => expect(vm.spaces.length).toBe(1));
    expect(api.listSpaces).toHaveBeenCalledTimes(1);
    expect(vm.activeSpaceId).toBe('p'); // lands on the personal space
  });

  it('reset() drops the cached spaces/breadcrumb and reloads for the new space', async () => {
    vi.mocked(api.listSpaces).mockResolvedValueOnce([space('p', 'personal'), space('a', 'shared')]);
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));
    vm.selectSpace('a');
    vm.enterFolder(7, 'sub');
    expect(vm.path.length).toBe(2);

    // Host switched Space → the module's space-changed handler calls reset().
    // Next tenant exposes a different space list.
    vi.mocked(api.listSpaces).mockResolvedValueOnce([space('p2', 'personal')]);
    vm.reset();
    // State is wiped synchronously before the reload resolves.
    expect(vm.spaces).toEqual([]);
    expect(vm.activeSpaceId).toBeNull();
    expect(vm.path).toEqual([]);

    await waitFor(() => expect(vm.spaces.length).toBe(1));
    expect(vm.spaces[0].id).toBe('p2'); // shows the NEW tenant's spaces, not stale 'a'
    expect(api.listSpaces).toHaveBeenCalledTimes(2);
  });

  it('reset() before the first load is a no-op (no fetch)', () => {
    const vm = new DriveVM();
    vm.reset();
    expect(api.listSpaces).not.toHaveBeenCalled();
  });

  it('a stale loadSpaces resolving after reset() does not overwrite the newer load (N1)', async () => {
    // First load hangs so we can resolve it out of order.
    let resolveOld: (s: Space[]) => void = () => {};
    vi.mocked(api.listSpaces).mockImplementationOnce(
      () => new Promise<Space[]>((res) => { resolveOld = res; }),
    );
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(api.listSpaces).toHaveBeenCalledTimes(1));

    // A rapid Space switch → reset() starts a newer load that resolves first.
    vi.mocked(api.listSpaces).mockResolvedValueOnce([space('p2', 'personal')]);
    vm.reset();
    await waitFor(() => expect(vm.spaces.map((s) => s.id)).toEqual(['p2']));

    // The superseded first load now resolves late with the OLD tenant's spaces —
    // the generation guard must drop it so it can't clobber the current view or
    // leave activeSpaceId pointing at a space absent from the list.
    resolveOld([space('p-old', 'personal'), space('old-shared', 'shared')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(vm.spaces.map((s) => s.id)).toEqual(['p2']);
    expect(vm.activeSpaceId).toBe('p2');
    expect(vm.spacesLoading).toBe(false);
  });

  it('ensureLoaded resets when the same instance is remounted under a different user', async () => {
    vi.mocked(api.listSpaces).mockResolvedValueOnce([space('p', 'personal')]);
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(1));

    // Same singleton, a different user now logged in (no full page reload).
    WKApp.loginInfo.uid = 'other-uid';
    vi.mocked(api.listSpaces).mockResolvedValueOnce([space('p2', 'personal'), space('b', 'shared')]);
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));
    expect(vm.spaces.map((s) => s.id)).toEqual(['p2', 'b']);
    expect(api.listSpaces).toHaveBeenCalledTimes(2);
  });
});

describe('DriveVM.focusFile', () => {
  it('root file jump keeps path at just the space root', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('p', 'personal'), space('s', 'shared')]);
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));

    await vm.focusFile('s', 42);
    expect(vm.activeSpaceId).toBe('s');
    expect(vm.path.length).toBe(1);
    expect(vm.path[0].id).toBe(0);
    expect(vm.highlightFileId).toBe(42);
    // no ancestors fetch for root files
    expect(api.getAncestors).not.toHaveBeenCalled();
  });

  it('deep file jump fetches ancestors and expands the breadcrumb root-first', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('p', 'personal'), space('s', 'shared')]);
    vi.mocked(api.getAncestors).mockResolvedValueOnce([
      { id: 10, name: 'A' },
      { id: 20, name: 'B' },
      { id: 30, name: 'C' },
    ]);
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));

    await vm.focusFile('s', 999, 30);
    expect(vm.activeSpaceId).toBe('s');
    // root crumb + 3 ancestors
    expect(vm.path.map((c) => c.id)).toEqual([0, 10, 20, 30]);
    expect(vm.path.map((c) => c.name).slice(1)).toEqual(['A', 'B', 'C']);
    expect(vm.highlightFileId).toBe(999);
    expect(api.getAncestors).toHaveBeenCalledWith(999);
  });

  it('unknown target space toasts and does not switch', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('p', 'personal')]);
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(1));
    const before = vm.activeSpaceId;

    // Caller was removed from shared-space 'gone' between save and click.
    await vm.focusFile('gone', 5);
    expect(vm.activeSpaceId).toBe(before); // no switch
    expect(vm.highlightFileId).toBeNull(); // no highlight
    // Second loadSpaces was invoked by focusFile's retry.
    expect(api.listSpaces).toHaveBeenCalledTimes(2);
  });

  it('getAncestors failure falls back to the space root breadcrumb', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('p', 'personal'), space('s', 'shared')]);
    vi.mocked(api.getAncestors).mockRejectedValueOnce(new Error('boom'));
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));

    await vm.focusFile('s', 777, 30);
    expect(vm.activeSpaceId).toBe('s');
    expect(vm.path.length).toBe(1); // no ancestors landed, root only
    expect(vm.highlightFileId).toBe(777); // still highlight the file
  });
});
