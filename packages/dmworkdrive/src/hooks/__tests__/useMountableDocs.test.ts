import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  listMountableDocs: vi.fn(),
  mountDoc: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useMountableDocs } from '../useMountableDocs';
import type { MountableDoc, MountableDocsResponse } from '../../bridge/types';

function doc(id: string, title = id): MountableDoc {
  return {
    doc_id: id,
    title,
    doc_type: 'html',
    owner_id: 'u',
    space_id: 'sp',
    access_type: 'owner',
    granted_role: 3,
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

function resp(items: MountableDoc[]): MountableDocsResponse {
  return { items, page: { page_size: 200, page_index: 0, total: items.length, data: items }, total: items.length };
}

beforeEach(() => {
  vi.mocked(api.listMountableDocs).mockReset();
  vi.mocked(api.mountDoc).mockReset();
});

describe('useMountableDocs', () => {
  it('loads candidates when enabled', async () => {
    vi.mocked(api.listMountableDocs).mockResolvedValue(resp([doc('d1'), doc('d2')]));
    const { result } = renderHook(() => useMountableDocs('sp', 0, true));
    await waitFor(() => expect(result.current.docs.length).toBe(2));
    expect(api.listMountableDocs).toHaveBeenCalledWith(
      expect.objectContaining({ space_id: 'sp' }),
      expect.anything(),
    );
  });

  it('does not fetch while disabled', async () => {
    const { result } = renderHook(() => useMountableDocs('sp', 0, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.docs).toEqual([]);
    expect(api.listMountableDocs).not.toHaveBeenCalled();
  });

  it('mounts a candidate and drops it from the list', async () => {
    vi.mocked(api.listMountableDocs).mockResolvedValue(resp([doc('d1'), doc('d2')]));
    vi.mocked(api.mountDoc).mockResolvedValue({} as never);
    const { result } = renderHook(() => useMountableDocs('sp', 7, true));
    await waitFor(() => expect(result.current.docs.length).toBe(2));

    let ok = false;
    await act(async () => {
      ok = await result.current.mount(doc('d1', 'First'));
    });
    expect(ok).toBe(true);
    expect(api.mountDoc).toHaveBeenCalledWith({
      space_id: 'sp',
      parent_id: 7,
      doc_id: 'd1',
      doc_title: 'First',
    });
    expect(result.current.docs.map((d) => d.doc_id)).toEqual(['d2']);
  });

  it('keeps the candidate on mount failure', async () => {
    vi.mocked(api.listMountableDocs).mockResolvedValue(resp([doc('d1')]));
    vi.mocked(api.mountDoc).mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useMountableDocs('sp', 0, true));
    await waitFor(() => expect(result.current.docs.length).toBe(1));

    let ok = true;
    await act(async () => {
      ok = await result.current.mount(doc('d1'));
    });
    expect(ok).toBe(false);
    expect(result.current.docs.length).toBe(1);
  });
});
