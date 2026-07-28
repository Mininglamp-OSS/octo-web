import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listShares: vi.fn(),
  createShare: vi.fn(),
  revokeShare: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useShare } from '../useShare';
import type { Share } from '../../bridge/types';

function share(id: string, fileId: number): Share {
  return {
    id,
    file_id: fileId,
    creator_uid: 'u',
    permission: 'view',
    password_set: false,
    created_at: '2026-07-23T10:00:00.000Z',
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

function dlShare(id: string, fileId: number, expiresAt?: string): Share {
  return { ...share(id, fileId), permission: 'download', expires_at: expiresAt };
}

beforeEach(() => {
  vi.mocked(api.listShares).mockReset();
  vi.mocked(api.createShare).mockReset();
  vi.mocked(api.revokeShare).mockReset();
});

describe('useShare', () => {
  it('loads and filters shares to the target file', async () => {
    vi.mocked(api.listShares).mockResolvedValue([share('s1', 10), share('s2', 99), share('s3', 10)]);
    const { result } = renderHook(() => useShare(10, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shares.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('does not load while disabled', async () => {
    const { result } = renderHook(() => useShare(10, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.listShares).not.toHaveBeenCalled();
    expect(result.current.shares).toEqual([]);
  });

  it('creates a share with view/download permission and prepends it', async () => {
    vi.mocked(api.listShares).mockResolvedValue([]);
    vi.mocked(api.createShare).mockResolvedValue(share('new', 10));
    const { result } = renderHook(() => useShare(10, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: Share | null = null;
    await act(async () => {
      created = await result.current.create('download', 604800, 'pw');
    });
    expect(created).not.toBeNull();
    expect(api.createShare).toHaveBeenCalledWith({
      file_id: 10,
      permission: 'download',
      expires_in_seconds: 604800,
      password: 'pw',
    });
    expect(result.current.shares[0].id).toBe('new');
  });

  it('revokes a share and removes it', async () => {
    vi.mocked(api.listShares).mockResolvedValue([share('s1', 10)]);
    vi.mocked(api.revokeShare).mockResolvedValue(undefined);
    const { result } = renderHook(() => useShare(10, true));
    await waitFor(() => expect(result.current.shares.length).toBe(1));

    await act(async () => {
      await result.current.revoke('s1');
    });
    expect(api.revokeShare).toHaveBeenCalledWith('s1');
    expect(result.current.shares).toEqual([]);
  });

  describe('ensure (WeCom one-shot)', () => {
    it('reuses an existing valid download link without creating', async () => {
      vi.mocked(api.listShares).mockResolvedValue([dlShare('dl1', 10)]);
      const { result } = renderHook(() => useShare(10, false));

      let got: Share | null = null;
      await act(async () => {
        got = await result.current.ensure();
      });
      expect(got!.id).toBe('dl1');
      expect(api.createShare).not.toHaveBeenCalled();
    });

    it('mints a permanent download link when none exists', async () => {
      vi.mocked(api.listShares).mockResolvedValue([]);
      vi.mocked(api.createShare).mockResolvedValue(dlShare('new', 10));
      const { result } = renderHook(() => useShare(10, false));

      let got: Share | null = null;
      await act(async () => {
        got = await result.current.ensure();
      });
      expect(got!.id).toBe('new');
      expect(api.createShare).toHaveBeenCalledWith({
        file_id: 10,
        permission: 'download',
        expires_in_seconds: 100 * 365 * 86400,
      });
    });

    it('ignores expired and non-download shares when reusing', async () => {
      const past = '2000-01-01T00:00:00.000Z';
      vi.mocked(api.listShares).mockResolvedValue([
        share('view1', 10), // wrong permission
        dlShare('exp', 10, past), // expired
      ]);
      vi.mocked(api.createShare).mockResolvedValue(dlShare('fresh', 10));
      const { result } = renderHook(() => useShare(10, false));

      let got: Share | null = null;
      await act(async () => {
        got = await result.current.ensure();
      });
      expect(got!.id).toBe('fresh');
      expect(api.createShare).toHaveBeenCalledOnce();
    });
  });
});
