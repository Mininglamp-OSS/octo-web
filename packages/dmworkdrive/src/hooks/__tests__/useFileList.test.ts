import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  browse: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useFileList, PAGE_SIZE } from '../useFileList';
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
    page: { page_size: PAGE_SIZE, page_index: 1, total: total ?? entries.length, data: entries },
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

  it('loads entries for the space/folder with the paginated PAGE_SIZE', async () => {
    vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'docs', 'folder'), entry(2, 'a.pdf', 'blob')]));
    const { result } = renderHook(() => useFileList('sp', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toHaveLength(2);
    expect(api.browse).toHaveBeenCalledWith(
      {
        space_id: 'sp',
        parent_id: 0,
        page_index: 1,
        page_size: PAGE_SIZE,
        type: undefined,
      },
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
        expect.objectContaining({ space_id: 'sp', parent_id: 5, page_index: 1 }),
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

  describe('pagination', () => {
    it('hasMore is true when the first page is full and total > page', async () => {
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      vi.mocked(api.browse).mockResolvedValue(resp(first, PAGE_SIZE * 3));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);
    });

    it('hasMore is false when the first page is shorter than PAGE_SIZE', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'a', 'blob')]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(false);
    });

    it('loadMore appends the next page and increments page_index', async () => {
      const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(i + 1, `n${i}`, 'blob'));
      const second = [entry(1000, 'tail', 'blob')];
      vi.mocked(api.browse)
        .mockResolvedValueOnce(resp(first, PAGE_SIZE + 1))
        .mockResolvedValueOnce({
          entries: second,
          page: { page_size: PAGE_SIZE, page_index: 2, total: PAGE_SIZE + 1, data: second },
          filter: { type: 'all', source: 'all' },
        });
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(PAGE_SIZE);
      expect(result.current.hasMore).toBe(true);

      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
      expect(result.current.entries).toHaveLength(PAGE_SIZE + 1);
      expect(api.browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ page_index: 2 }),
        expect.anything(),
      );
      expect(result.current.hasMore).toBe(false);
    });

    it('loadMore is a no-op when hasMore is false', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([entry(1, 'a', 'blob')]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(false);
      const before = vi.mocked(api.browse).mock.calls.length;
      act(() => result.current.loadMore());
      // No additional browse call.
      expect(vi.mocked(api.browse).mock.calls.length).toBe(before);
    });
  });

  describe('type filter', () => {
    it('starts at "all" and passes type=undefined', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.filter).toBe('all');
      expect(api.browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: undefined }),
        expect.anything(),
      );
    });

    it('setFilter triggers a fresh page-1 fetch with the type param', async () => {
      vi.mocked(api.browse).mockResolvedValue(resp([]));
      const { result } = renderHook(() => useFileList('sp', 0));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.setFilter('folder'));
      await waitFor(() =>
        expect(api.browse).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: 'folder', page_index: 1 }),
          expect.anything(),
        ),
      );
    });
  });
});
