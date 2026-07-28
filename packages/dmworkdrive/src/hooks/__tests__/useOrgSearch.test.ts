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
});
