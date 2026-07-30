import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listOrgMembers: vi.fn(),
}));

import * as api from '../../api/driveApi';
// Aliased to the @octo/base mock (vite.config): same mittBus singleton the hook
// subscribes to, so emitting here drives the hook's space-changed handler.
import { WKApp } from '@octo/base';
import { useOrgSearch } from '../useOrgSearch';
import type { OrgCandidate, OrgSearchResponse } from '../../bridge/types';

function cand(uid: string, name = uid): OrgCandidate {
  return { uid, name };
}
function resp(cands: OrgCandidate[]): OrgSearchResponse {
  return { candidates: cands, total: cands.length };
}
function deferred(): { promise: Promise<OrgSearchResponse>; resolve: (v: OrgSearchResponse) => void } {
  let resolve!: (v: OrgSearchResponse) => void;
  const promise = new Promise<OrgSearchResponse>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(api.listOrgMembers).mockReset();
  vi.mocked(api.listOrgMembers).mockResolvedValue(resp([]));
});

describe('useOrgSearch', () => {
  it('fetches the full roster once on mount and caches it', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValue(resp([cand('u1', 'Alice'), cand('u2', 'Bob')]));
    const { result, unmount } = renderHook(() => useOrgSearch());

    await waitFor(() => expect(result.current.candidates.length).toBe(2));
    expect(api.listOrgMembers).toHaveBeenCalledTimes(1);
    // Scoped by the X-Space-Id header (api layer), so no space arg is passed.
    expect(api.listOrgMembers).toHaveBeenCalledWith(expect.anything());
    unmount();
  });

  it('filters the cached roster locally by name substring — no extra backend call', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValue(
      resp([cand('u1', 'Alice'), cand('u2', 'Bob'), cand('u3', 'Carol')]),
    );
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.candidates.length).toBe(3));

    act(() => result.current.search('ali'));
    expect(result.current.query).toBe('ali');
    expect(result.current.candidates).toEqual([cand('u1', 'Alice')]);
    // Local-only: the roster was fetched once, never again on keystrokes.
    expect(api.listOrgMembers).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('filters the cached roster locally by pinyin of a CJK name', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValue(
      resp([cand('u1', 'Alice'), cand('u2', '张三')]),
    );
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.candidates.length).toBe(2));

    act(() => result.current.search('zhang'));
    expect(result.current.candidates).toEqual([cand('u2', '张三')]);
    expect(api.listOrgMembers).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('an empty query restores the full cached roster', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValue(resp([cand('u1', 'Alice'), cand('u2', 'Bob')]));
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.candidates.length).toBe(2));

    act(() => result.current.search('ali'));
    expect(result.current.candidates.length).toBe(1);
    act(() => result.current.search('   '));
    expect(result.current.candidates.length).toBe(2);
    unmount();
  });

  // ── F1: re-fetch keys on the host octo space, NOT the drive space ──────────

  it('does not re-fetch when the drive space changes (hook re-renders)', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValue(resp([cand('u1', 'Alice')]));
    // The hook takes no space arg — drive activeSpaceId lives on the consumer.
    // A drive personal→shared switch re-renders the consumer (undefined→personal
    // →shared); none of that may touch the backend. Only host space-changed does.
    const { result, rerender, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.candidates.length).toBe(1));

    act(() => rerender());
    act(() => rerender());
    expect(api.listOrgMembers).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('reloads on host space-changed: clears old candidates+query synchronously and issues one new request', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValueOnce(resp([cand('a1', 'A-Alice'), cand('a2', 'A-Bob')]));
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.candidates.length).toBe(2));
    act(() => result.current.search('a-alice'));
    expect(result.current.query).toBe('a-alice');

    // Next load is a controllable pending promise so we can observe the sync clear.
    const late = deferred();
    vi.mocked(api.listOrgMembers).mockReturnValueOnce(late.promise);
    act(() => WKApp.mittBus.emit('space-changed'));

    // Synchronous: previous space's candidates + query dropped before B lands.
    expect(result.current.query).toBe('');
    expect(result.current.candidates).toEqual([]);
    expect(api.listOrgMembers).toHaveBeenCalledTimes(2);

    await act(async () => { late.resolve(resp([cand('b1', 'B-Carol')])); await Promise.resolve(); });
    expect(result.current.candidates).toEqual([cand('b1', 'B-Carol')]);
    unmount();
  });

  it('a late previous-generation response cannot write back after space-changed', async () => {
    // gen-1 stays pending; space-changed spawns gen-2 which resolves first.
    const genA = deferred();
    vi.mocked(api.listOrgMembers).mockReturnValueOnce(genA.promise);
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.loading).toBe(true));

    vi.mocked(api.listOrgMembers).mockResolvedValueOnce(resp([cand('b1', 'B-Carol')]));
    act(() => WKApp.mittBus.emit('space-changed'));
    expect(api.listOrgMembers).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.candidates).toEqual([cand('b1', 'B-Carol')]));

    // gen-1 (aborted) responds late — the aborted-signal guard must swallow it.
    await act(async () => { genA.resolve(resp([cand('a1', 'A-STALE')])); await Promise.resolve(); });
    expect(result.current.candidates).toEqual([cand('b1', 'B-Carol')]);
    unmount();
  });

  it('a late roster response cannot write back after unmount', async () => {
    const late = deferred();
    vi.mocked(api.listOrgMembers).mockReturnValueOnce(late.promise);
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.loading).toBe(true));

    unmount();
    await act(async () => { late.resolve(resp([cand('u1', 'Alice')])); await Promise.resolve(); });
    expect(result.current.candidates).toEqual([]);
  });

  it('on unmount removes the listener: a later space-changed does not fetch', async () => {
    vi.mocked(api.listOrgMembers).mockResolvedValue(resp([cand('u1', 'Alice')]));
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.candidates.length).toBe(1));
    expect(api.listOrgMembers).toHaveBeenCalledTimes(1);

    unmount();
    act(() => WKApp.mittBus.emit('space-changed'));
    expect(api.listOrgMembers).toHaveBeenCalledTimes(1);
  });

  // ── F2: a query typed while loading survives the roster resolve ────────────

  it('keeps a query typed during load: resolves filtered to the query, not the full roster', async () => {
    const load = deferred();
    vi.mocked(api.listOrgMembers).mockReturnValueOnce(load.promise);
    const { result, unmount } = renderHook(() => useOrgSearch());
    await waitFor(() => expect(result.current.loading).toBe(true));

    act(() => result.current.search('zhang'));
    expect(result.current.query).toBe('zhang');

    await act(async () => {
      load.resolve(resp([cand('u1', '张三'), cand('u2', '李四')]));
      await Promise.resolve();
    });
    // Query preserved; roster filtered to it — the full list must not clobber.
    expect(result.current.query).toBe('zhang');
    expect(result.current.candidates).toEqual([cand('u1', '张三')]);
    unmount();
  });
});
