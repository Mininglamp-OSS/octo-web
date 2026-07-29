import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useMembers } from '../useMembers';
import type { Member, DriveRole } from '../../bridge/types';

const SA = 'uid-sa';
const ME = 'test-uid'; // matches __mocks__ WKApp.loginInfo.uid

function member(uid: string, role: DriveRole): Member {
  return {
    space_id: 'sp',
    uid,
    role,
    granted_by: SA,
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  };
}

beforeEach(() => {
  vi.mocked(api.listMembers).mockReset();
  vi.mocked(api.updateMemberRole).mockReset();
  vi.mocked(api.removeMember).mockReset();
});

describe('useMembers', () => {
  it('does not fetch while disabled', async () => {
    const { result } = renderHook(() => useMembers('sp', false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.listMembers).not.toHaveBeenCalled();
  });

  it('derives super_admin capabilities and the creator uid', async () => {
    vi.mocked(api.listMembers).mockResolvedValue([member(ME, 'super_admin'), member('u1', 'editor')]);
    const { result } = renderHook(() => useMembers('sp', true));
    await waitFor(() => expect(result.current.members.length).toBe(2));
    expect(result.current.myRole).toBe('super_admin');
    expect(result.current.canManage).toBe(true);
    expect(result.current.canGrantAdmin).toBe(true);
    expect(result.current.superAdminUid).toBe(ME);
  });

  it('an admin can manage but cannot grant admin', async () => {
    vi.mocked(api.listMembers).mockResolvedValue([member(SA, 'super_admin'), member(ME, 'admin')]);
    const { result } = renderHook(() => useMembers('sp', true));
    await waitFor(() => expect(result.current.members.length).toBe(2));
    expect(result.current.myRole).toBe('admin');
    expect(result.current.canManage).toBe(true);
    expect(result.current.canGrantAdmin).toBe(false);
    expect(result.current.superAdminUid).toBe(SA);
  });

  it('a low-privilege member cannot manage', async () => {
    vi.mocked(api.listMembers).mockResolvedValue([member(SA, 'super_admin'), member(ME, 'editor')]);
    const { result } = renderHook(() => useMembers('sp', true));
    await waitFor(() => expect(result.current.myRole).toBe('editor'));
    expect(result.current.canManage).toBe(false);
    expect(result.current.canGrantAdmin).toBe(false);
  });

  it('updateRole calls the API and updates the row optimistically', async () => {
    vi.mocked(api.listMembers).mockResolvedValue([member(SA, 'super_admin'), member('u1', 'preview_only')]);
    vi.mocked(api.updateMemberRole).mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useMembers('sp', true));
    await waitFor(() => expect(result.current.members.length).toBe(2));
    await act(async () => {
      await result.current.updateRole('u1', 'editor');
    });
    expect(api.updateMemberRole).toHaveBeenCalledWith('sp', 'u1', { role: 'editor' });
    expect(result.current.members.find((m) => m.uid === 'u1')?.role).toBe('editor');
  });

  it('remove calls the API and drops the row', async () => {
    vi.mocked(api.listMembers).mockResolvedValue([member(SA, 'super_admin'), member('u1', 'editor')]);
    vi.mocked(api.removeMember).mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useMembers('sp', true));
    await waitFor(() => expect(result.current.members.length).toBe(2));
    await act(async () => {
      await result.current.remove('u1');
    });
    expect(api.removeMember).toHaveBeenCalledWith('sp', 'u1');
    expect(result.current.members.find((m) => m.uid === 'u1')).toBeUndefined();
  });

  it('passes an abort signal and drops a stale space response (B5)', async () => {
    // Old space request hangs until we resolve it late.
    let resolveOld: (m: Member[]) => void = () => {};
    vi.mocked(api.listMembers).mockImplementationOnce(
      () => new Promise<Member[]>((res) => { resolveOld = res; }),
    );
    const { result, rerender } = renderHook(
      (props: { sp: string }) => useMembers(props.sp, true),
      { sp: 'sp-old' },
    );
    await waitFor(() => expect(api.listMembers).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(api.listMembers).mock.calls[0][1] as AbortSignal;
    expect(typeof signal.aborted).toBe('boolean');

    // Switch spaces mid-flight; the new space resolves immediately.
    vi.mocked(api.listMembers).mockResolvedValueOnce([member('u-new', 'editor')]);
    rerender({ sp: 'sp-new' });
    await waitFor(() => expect(result.current.members.map((m) => m.uid)).toEqual(['u-new']));

    // The old space's response arrives late — its controller was aborted on the
    // switch, so it must NOT overwrite the current space's members.
    await act(async () => {
      resolveOld([member('u-old', 'admin')]);
      await Promise.resolve();
    });
    expect(result.current.members.map((m) => m.uid)).toEqual(['u-new']);
  });
});
