import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  browse: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useFileList } from '../useFileList';
import type { DriveEntry, FileType, BrowseResponse } from '../../bridge/types';

function entry(id: number, name: string, type: FileType): DriveEntry {
  return {
    id,
    space_id: 'sp',
    parent_id: 0,
    name,
    is_folder: type === 'folder',
    type,
    size: type === 'blob' ? 100 : 0,
    source: 'user-upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

function resp(entries: DriveEntry[], total?: number): BrowseResponse {
  return {
    entries,
    page: { page_size: 200, page_index: 1, total: total ?? entries.length, data: entries },
    filter: { type: 'all', source: 'all' },
  };
}

beforeEach(() => {
  vi.mocked(api.browse).mockReset();
});

describe('useFileList', () => {
  it('does not call browse when spaceId is null', async () => {
    const { result } = renderHook(() => useFileList(null, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(api.browse).not.toHaveBeenCalled();
  });

  it('loads entries for the space/folder', async () => {
    vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'docs', 'folder'), entry(2, 'a.pdf', 'blob')]));
    const { result } = renderHook(() => useFileList('sp', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toHaveLength(2);
    expect(api.browse).toHaveBeenCalledWith(
      { space_id: 'sp', parent_id: 0, page_size: 200 },
      expect.anything(),
    );
  });

  it('reloads when parentId changes', async () => {
    vi.mocked(api.browse).mockResolvedValue(resp([]));
    const { rerender } = renderHook((props: { p: number }) => useFileList('sp', props.p), {
      p: 0,
    });
    await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(1));

    rerender({ p: 5 });
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith(
        { space_id: 'sp', parent_id: 5, page_size: 200 },
        expect.anything(),
      ),
    );
  });

  it('surfaces an error when browse fails', async () => {
    vi.mocked(api.browse).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useFileList('sp', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('nope');
  });

  it('drops a browse that resolves after the space is reset to null (P0-2 stale leak)', async () => {
    // Space A's browse hangs so we can resolve it out of order.
    let resolveA: (r: BrowseResponse) => void = () => {};
    vi.mocked(api.browse).mockImplementationOnce(
      () => new Promise<BrowseResponse>((res) => { resolveA = res; }),
    );
    const { result, rerender } = renderHook(
      (props: { sp: string | null }) => useFileList(props.sp, 0),
      { sp: 'A' as string | null },
    );
    await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(1));

    // DriveVM.reset() drops the active space → spaceId null. Entries clear.
    rerender({ sp: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);

    // Space A's browse resolves LATE — the null transition aborted it, so it
    // must not write the previous tenant's entries back over the cleared view.
    await act(async () => {
      resolveA(resp([entry(1, 'stale', 'blob')]));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.entries).toEqual([]);
  });

  it('clears error and truncatedTotal on transition to no-space', async () => {
    // A failed browse in space A followed by a reset to no-space would
    // otherwise leave the "Failed to load" banner rendered against a state
    // where no browse applies. Verify the !spaceId branch clears both.
    vi.mocked(api.browse).mockRejectedValueOnce(new Error('boom'));
    const { result, rerender } = renderHook(
      (props: { sp: string | null }) => useFileList(props.sp, 0),
      { sp: 'A' as string | null },
    );
    await waitFor(() => expect(result.current.error).toBe('boom'));

    rerender({ sp: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.truncatedTotal).toBeNull();
  });

  describe('truncatedTotal', () => {
    it('is null when the response fully fits within PAGE_SIZE', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'a.pdf', 'blob')], 1));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.truncatedTotal).toBeNull();
    });

    it('is set when the server reports a total larger than the returned list', async () => {
      // 200 rows returned, server says 350 total → capped view.
      const rows = Array.from({ length: 200 }, (_, i) =>
        entry(i + 1, `f${i}.pdf`, 'blob'),
      );
      vi.mocked(api.browse).mockResolvedValue(resp(rows, 350));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.truncatedTotal).toBe(350);
    });
  });

  describe('type filter', () => {
    it('starts at "all" and passes type=undefined', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([]));
      renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(1));
      expect(api.browse).toHaveBeenCalledWith(
        { space_id: 'sp', parent_id: 0, page_size: 200 },
        expect.anything(),
      );
    });

    it('setFilter triggers a fresh fetch with the type param', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.setFilter('folder'));
      await waitFor(() =>
        expect(api.browse).toHaveBeenLastCalledWith(
          { space_id: 'sp', parent_id: 0, type: 'folder', page_size: 200 },
          expect.anything(),
        ),
      );
    });

    it('clears stale entries synchronously on context change even when the new fetch rejects (P1-2)', async () => {
      // Bot review round-10 P1-2: switching filter/space/folder while
      // a previous listing is on screen used to keep the previous
      // listing visible if the new fetch rejected — same file rows
      // under a different filter/breadcrumb, fully actionable. Guard:
      // the useEffect keyed on load clears entries SYNCHRONOUSLY on
      // context change, so a rejected new-context browse yields an
      // empty list + error, not a mixed view.
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp([entry(1, 'a.pdf', 'blob')]))
        .mockRejectedValueOnce(new Error('boom'));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.entries).toHaveLength(1));

      act(() => result.current.setFilter('folder'));
      // Between the setFilter call and the reject, entries MUST clear
      // synchronously so the caller can't wire delete/move handlers
      // to the previous filter's rows under the new filter's UI.
      await waitFor(() => expect(result.current.error).toBe('boom'));
      expect(result.current.entries).toEqual([]);
    });

    it('a stale reload() bound to a previous context is dropped without touching abortRef (P1-1)', async () => {
      // Bot review round-10 P1-1: a batch-delete onOk (or MoveModal
      // onConfirm) captures reload() bound to the CURRENT context. If
      // the user switches space while the batch runs, the captured
      // reload() fires against space A after space B's browse has
      // started. Without the pre-abort contextRef guard, A's reload
      // would abort B's in-flight browse and claim the newest seq,
      // then A's response would land under B's breadcrumb.
      //
      // Test: capture a reload() in space A, switch to B, invoke the
      // captured reload — assert that B's second browse call is NOT
      // aborted (i.e. no extra browse fires from the stale reload,
      // and B's entries land intact).
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp([entry(1, 'a-file', 'blob')])) // A initial
        .mockResolvedValueOnce(resp([entry(2, 'b-file', 'blob')])); // B initial after switch

      const { result, rerender } = renderHook(
        (props: { sp: string }) => useFileList(props.sp, 0),
        { sp: 'A' },
      );
      await waitFor(() => expect(result.current.entries[0]?.id).toBe(1));

      // Capture reload() from A (equivalent to what a modal onOk closure
      // would hold).
      const staleReloadFromA = result.current.reload;

      // Switch to B.
      rerender({ sp: 'B' });
      await waitFor(() => expect(result.current.entries[0]?.id).toBe(2));

      // Now the stale A reload fires. It MUST no-op — no third browse
      // call, entries stay as B's.
      act(() => staleReloadFromA());
      await new Promise((r) => setTimeout(r, 10));

      expect(vi.mocked(api.browse)).toHaveBeenCalledTimes(2);
      expect(result.current.entries[0]?.id).toBe(2);
    });
  });
});
