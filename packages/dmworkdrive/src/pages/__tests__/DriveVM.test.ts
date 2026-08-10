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

  // Reviewer P1-1 round 2 (Jerry-Xin / yujiawei / Octo-Q): focusFile used to
  // split its state transition across the getAncestors await, committing
  // activeSpaceId synchronously and path/highlight after. DriveContent
  // subscribes to (activeSpaceId, currentParentId) and issued a
  // cross-space browse during the RTT with the previous space's parent_id.
  // The fix (focusSeq guard + resolve-then-commit) pins ALL three writes
  // to happen after the ancestor RTT, and a second concurrent focusFile
  // that lands first must not be clobbered by the first's late resolution.
  it('deep-jump commits activeSpaceId / path / highlight atomically after ancestors resolve', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('a', 'personal'), space('b', 'shared')]);
    // Ancestors takes a controllable amount of time — first call is slow.
    let releaseFirst: (v: Array<{ id: number; name: string }>) => void = () => {};
    vi.mocked(api.getAncestors).mockImplementationOnce(
      () => new Promise((r) => { releaseFirst = r; }),
    );
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));

    // Seed a stale state: pretend the user already had space 'a' open at
    // folder id 300 before the deep-jump click.
    vm.selectSpace('a');
    vm.enterFolder(300, 'folder-300');
    expect(vm.activeSpaceId).toBe('a');
    expect(vm.currentParentId).toBe(300);

    // Fire focusFile('b', 999, 501) — should NOT commit activeSpaceId='b'
    // synchronously (that would leave currentParentId=300 pointing at a
    // folder from space 'a' → cross-space browse). All three writes
    // (activeSpaceId, path, highlightFileId) must land together after
    // the ancestors resolve.
    const jump = vm.focusFile('b', 999, 501);
    // Micro-tick: nothing should have moved yet — the await ancestors is
    // still pending, and pre-commit state must still show the old space.
    await Promise.resolve();
    expect(vm.activeSpaceId).toBe('a'); // still the old space
    expect(vm.currentParentId).toBe(300); // still the old folder

    releaseFirst([{ id: 501, name: 'target-parent' }]);
    await jump;
    expect(vm.activeSpaceId).toBe('b');
    expect(vm.path.map((c) => c.id)).toEqual([0, 501]);
    expect(vm.highlightFileId).toBe(999);
  });

  it('a newer focusFile wins over a slower older jump (out-of-order ancestors)', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('s1', 'personal'), space('s2', 'shared')]);
    // First call slow, second call fast.
    let releaseSlow: (v: Array<{ id: number; name: string }>) => void = () => {};
    vi.mocked(api.getAncestors)
      .mockImplementationOnce(() => new Promise((r) => { releaseSlow = r; }))
      .mockImplementationOnce(() => Promise.resolve([{ id: 201, name: 'p2' }]));
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));

    const slow = vm.focusFile('s1', 111, 101);
    // Second click while the first's ancestors are still in flight.
    await vm.focusFile('s2', 222, 201);
    // Fast one has committed to s2 already.
    expect(vm.activeSpaceId).toBe('s2');
    expect(vm.highlightFileId).toBe(222);
    // Now let the slow first call resolve. It MUST NOT overwrite the
    // s2 state — the focusSeq guard drops it.
    releaseSlow([{ id: 101, name: 'p1' }]);
    await slow;
    expect(vm.activeSpaceId).toBe('s2');
    expect(vm.highlightFileId).toBe(222);
    expect(vm.path.map((c) => c.id)).toEqual([0, 201]);
  });

  // Round-4 P1 (Jerry-Xin / yujiawei / Octo-Q): a focusFile continuation
  // awaiting getAncestors when a host tenant switch fires reset() used
  // to still pass its focusSeq guard and commit the OLD tenant's state
  // into the freshly-reset VM. The self-heal path (activeSpaceId being
  // null after reset so loadSpaces re-selects personal) was accidentally
  // removed in round-2's atomicity fix. reset() must invalidate every
  // in-flight focus so its continuation refuses to write.
  it('reset() during a focusFile await invalidates the continuation (focus-vs-reset)', async () => {
    // Two "tenants": t1 has an initial listSpaces answer, t2 has the
    // fresh answer post-reset.
    vi.mocked(api.listSpaces)
      .mockResolvedValueOnce([space('t1-shared', 'shared'), space('t1-personal', 'personal')])
      .mockResolvedValueOnce([space('t2-personal', 'personal')]);
    let releaseAncestors: (v: Array<{ id: number; name: string }>) => void = () => {};
    vi.mocked(api.getAncestors).mockImplementationOnce(
      () => new Promise((r) => { releaseAncestors = r; }),
    );
    const vm = new DriveVM();
    vm.ensureLoaded();
    await waitFor(() => expect(vm.spaces.length).toBe(2));

    // Kick a deep-jump under t1; ancestors is pending.
    const jump = vm.focusFile('t1-shared', 999, 77);
    await Promise.resolve();
    // Simulate a host tenant switch mid-flight: reset() bumps loadSeq +
    // focusSeq, clears state, and kicks a fresh loadSpaces.
    vm.reset();
    // Fresh tenant's listSpaces resolves.
    await waitFor(() => expect(vm.spaces.length).toBe(1));
    expect(vm.spaces[0].id).toBe('t2-personal');
    // t2's loadSpaces auto-selected the personal space.
    expect(vm.activeSpaceId).toBe('t2-personal');

    // Now release the stale ancestors. The continuation must NOT
    // clobber activeSpaceId / path / highlight with t1's data.
    releaseAncestors([{ id: 77, name: 'stale-parent' }]);
    await jump;

    expect(vm.activeSpaceId).toBe('t2-personal'); // NOT 't1-shared'
    expect(vm.highlightFileId).toBeNull(); // reset cleared it, continuation didn't write
    // Breadcrumb belongs to the new tenant, not the old one's [0, 77].
    expect(vm.path.map((c) => c.id)).not.toContain(77);
  });
});
