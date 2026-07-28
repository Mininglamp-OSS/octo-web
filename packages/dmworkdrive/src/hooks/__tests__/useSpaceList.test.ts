import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listSpaces: vi.fn(),
  ensurePersonalSpace: vi.fn(),
  createSharedSpace: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useSpaceList } from '../useSpaceList';
import type { Space, SpaceType } from '../../bridge/types';

function space(id: string, type: SpaceType, name: string): Space {
  return { id, type, name, super_admin_uid: 'u', created_at: '', updated_at: '' };
}

beforeEach(() => {
  vi.mocked(api.listSpaces).mockReset();
  vi.mocked(api.ensurePersonalSpace).mockReset();
  vi.mocked(api.createSharedSpace).mockReset();
});

describe('useSpaceList', () => {
  it('loads and splits personal vs shared', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([
      space('p', 'personal', 'Me'),
      space('s1', 'shared', 'Team A'),
      space('s2', 'shared', 'Team B'),
    ]);

    const { result } = renderHook(() => useSpaceList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.personalSpace?.id).toBe('p');
    expect(result.current.sharedSpaces.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(api.ensurePersonalSpace).not.toHaveBeenCalled();
  });

  it('lazily ensures a personal space when none is returned', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('s1', 'shared', 'Team A')]);
    vi.mocked(api.ensurePersonalSpace).mockResolvedValue(space('p', 'personal', 'Me'));

    const { result } = renderHook(() => useSpaceList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.ensurePersonalSpace).toHaveBeenCalledTimes(1);
    expect(result.current.personalSpace?.id).toBe('p');
  });

  it('createShared calls the api and appends to the list', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([space('p', 'personal', 'Me')]);
    vi.mocked(api.createSharedSpace).mockResolvedValue(space('s2', 'shared', 'New'));

    const { result } = renderHook(() => useSpaceList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createShared('New');
    });

    expect(api.createSharedSpace).toHaveBeenCalledWith({ name: 'New' });
    expect(result.current.sharedSpaces.some((s) => s.id === 's2')).toBe(true);
  });

  it('surfaces an error when listing fails', async () => {
    vi.mocked(api.listSpaces).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useSpaceList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('boom');
  });
});
