import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WKApp } from '@octo/base';
import { waitFor } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listSpaces: vi.fn(),
  ensurePersonalSpace: vi.fn(),
  createSharedSpace: vi.fn(),
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
