import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listInvites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  addMember: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useInvite } from '../useInvite';
import type { Invite } from '../../bridge/types';

function invite(id: string): Invite {
  return {
    id,
    space_id: 'sp',
    role: 'editor',
    token: `tok_${id}`,
    creator_uid: 'u',
    created_at: '2026-07-23T10:00:00.000Z',
  };
}

beforeEach(() => {
  vi.mocked(api.listInvites).mockReset();
  vi.mocked(api.createInvite).mockReset();
  vi.mocked(api.revokeInvite).mockReset();
  vi.mocked(api.addMember).mockReset();
});

describe('useInvite', () => {
  it('loads invites when enabled', async () => {
    vi.mocked(api.listInvites).mockResolvedValue([invite('i1')]);
    const { result } = renderHook(() => useInvite('sp', true));
    await waitFor(() => expect(result.current.invites.length).toBe(1));
    expect(api.listInvites).toHaveBeenCalledWith('sp');
  });

  it('creates an invite and prepends it', async () => {
    vi.mocked(api.listInvites).mockResolvedValue([]);
    vi.mocked(api.createInvite).mockResolvedValue(invite('new'));
    const { result } = renderHook(() => useInvite('sp', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create('editor', 604800);
    });
    expect(api.createInvite).toHaveBeenCalledWith('sp', { role: 'editor', expires_in_seconds: 604800 });
    expect(result.current.invites[0].id).toBe('new');
  });

  it('revokes an invite and removes it', async () => {
    vi.mocked(api.listInvites).mockResolvedValue([invite('i1')]);
    vi.mocked(api.revokeInvite).mockResolvedValue(undefined);
    const { result } = renderHook(() => useInvite('sp', true));
    await waitFor(() => expect(result.current.invites.length).toBe(1));

    await act(async () => {
      await result.current.revoke('i1');
    });
    expect(api.revokeInvite).toHaveBeenCalledWith('sp', 'i1');
    expect(result.current.invites).toEqual([]);
  });

  it('adds picked org members one call per uid', async () => {
    vi.mocked(api.listInvites).mockResolvedValue([]);
    vi.mocked(api.addMember).mockResolvedValue({} as never);
    const { result } = renderHook(() => useInvite('sp', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.addMembers(['u1', 'u2'], 'downloader');
    });
    expect(ok).toBe(true);
    expect(api.addMember).toHaveBeenCalledTimes(2);
    expect(api.addMember).toHaveBeenCalledWith('sp', { uid: 'u1', role: 'downloader' });
    expect(api.addMember).toHaveBeenCalledWith('sp', { uid: 'u2', role: 'downloader' });
  });

  it('reports success when at least one member is added despite partial failure', async () => {
    vi.mocked(api.listInvites).mockResolvedValue([]);
    vi.mocked(api.addMember)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('already member'));
    const { result } = renderHook(() => useInvite('sp', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.addMembers(['u1', 'u2'], 'editor');
    });
    expect(ok).toBe(true);
  });
});
