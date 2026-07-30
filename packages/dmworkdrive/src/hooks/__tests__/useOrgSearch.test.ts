import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  searchOrgUser: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useOrgSearch } from '../useOrgSearch';
import type { OrgCandidate, OrgSearchResponse } from '../../bridge/types';

function cand(uid: string, name = uid): OrgCandidate {
  return { uid, name };
}
function resp(cands: OrgCandidate[]): OrgSearchResponse {
  return { candidates: cands, total: cands.length };
}

beforeEach(() => {
  vi.mocked(api.searchOrgUser).mockReset();
  vi.mocked(api.searchOrgUser).mockResolvedValue(resp([]));
});

describe('useOrgSearch', () => {
  it('debounces then searches and stores candidates', async () => {
    vi.mocked(api.searchOrgUser).mockResolvedValue(resp([cand('u1', 'Alice'), cand('u2', 'Bob')]));
    const { result } = renderHook(() => useOrgSearch('sp'));

    act(() => result.current.search('al'));
    expect(result.current.query).toBe('al');

    await waitFor(() => expect(result.current.candidates.length).toBe(2));
    expect(api.searchOrgUser).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'al', space_id: 'sp' }),
      expect.anything(),
    );
  });

  it('lists team members for an empty query (default view)', async () => {
    vi.mocked(api.searchOrgUser).mockResolvedValue(resp([cand('u1', 'Alice'), cand('u2', 'Bob')]));
    const { result } = renderHook(() => useOrgSearch('sp'));

    act(() => result.current.search('   '));
    await waitFor(() => expect(result.current.candidates.length).toBe(2));
    expect(api.searchOrgUser).toHaveBeenCalledWith(
      expect.objectContaining({ q: '   ', space_id: 'sp' }),
      expect.anything(),
    );
  });

  it('coalesces rapid keystrokes into one trailing search', async () => {
    vi.mocked(api.searchOrgUser).mockResolvedValue(resp([cand('u9')]));
    const { result } = renderHook(() => useOrgSearch());

    act(() => {
      result.current.search('a');
      result.current.search('ab');
      result.current.search('abc');
    });
    await waitFor(() => expect(result.current.candidates.length).toBe(1));
    expect(api.searchOrgUser).toHaveBeenCalledTimes(1);
    expect(api.searchOrgUser).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'abc' }),
      expect.anything(),
    );
  });

  it('clears candidates/query/loading synchronously on a space switch (no stale carry)', async () => {
    vi.mocked(api.searchOrgUser).mockResolvedValue(resp([cand('a1', 'A-Alice'), cand('a2', 'A-Bob')]));
    const { result, rerender } = renderHook((sp: string) => useOrgSearch(sp), 'space-A' as string);

    act(() => result.current.search('alice'));
    expect(result.current.query).toBe('alice');
    await waitFor(() => expect(result.current.candidates.length).toBe(2));

    // Switch space: state is dropped immediately, without waiting for a debounce
    // or a new response to land.
    act(() => rerender('space-B'));
    expect(result.current.candidates).toEqual([]);
    expect(result.current.query).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('a late Space A response cannot write back after switching to Space B; B search uses B params', async () => {
    let resolveA!: (v: OrgSearchResponse) => void;
    // First call (Space A) hangs until we resolve it manually; later calls (B) resolve normally.
    vi.mocked(api.searchOrgUser).mockResolvedValue(resp([cand('b1', 'B-Carol')]));
    vi.mocked(api.searchOrgUser).mockImplementationOnce(
      () => new Promise<OrgSearchResponse>((res) => { resolveA = res; }),
    );

    const { result, rerender } = renderHook((sp: string) => useOrgSearch(sp), 'space-A' as string);

    act(() => result.current.search('alice'));
    await waitFor(() => expect(result.current.loading).toBe(true)); // A request in-flight

    // Switch to B: A's request is aborted and state cleared.
    act(() => rerender('space-B'));
    expect(result.current.candidates).toEqual([]);

    // A's response arrives late — must be discarded (aborted-signal guard).
    await act(async () => {
      resolveA(resp([cand('a1', 'A-Alice'), cand('a2', 'A-Bob')]));
      await Promise.resolve();
    });
    expect(result.current.candidates).toEqual([]);

    // A fresh search now targets Space B only.
    act(() => result.current.search('carol'));
    await waitFor(() => expect(result.current.candidates).toEqual([cand('b1', 'B-Carol')]));
    expect(api.searchOrgUser).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'carol', space_id: 'space-B' }),
      expect.anything(),
    );
  });
});
