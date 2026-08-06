import { describe, it, expect } from 'vitest';
import { renderHook, act } from '../../__tests__/harness';

import { useSelection } from '../useSelection';
import type { DriveEntry, FileType } from '../../bridge/types';

function entry(id: number, name: string = `n${id}`, type: FileType = 'blob'): DriveEntry {
  return {
    id,
    space_id: 'sp',
    parent_id: 0,
    name,
    is_folder: type === 'folder',
    type,
    size: 100,
    source: 'user-upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

describe('useSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSelection([entry(1), entry(2)], 'k1'));
    expect(result.current.count).toBe(0);
    expect(result.current.hasSelection).toBe(false);
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.isIndeterminate).toBe(false);
    expect(result.current.selectedEntries).toEqual([]);
  });

  it('toggle adds and removes ids', () => {
    const entries = [entry(1), entry(2), entry(3)];
    const { result } = renderHook(() => useSelection(entries, 'k'));

    act(() => result.current.toggle(1));
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isIndeterminate).toBe(true);

    act(() => result.current.toggle(2));
    expect(result.current.count).toBe(2);

    act(() => result.current.toggle(1));
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected(1)).toBe(false);
  });

  it('toggleAll selects all visible then clears', () => {
    const entries = [entry(1), entry(2), entry(3)];
    const { result } = renderHook(() => useSelection(entries, 'k'));

    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(3);
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.isIndeterminate).toBe(false);

    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
    expect(result.current.isAllSelected).toBe(false);
  });

  it('selectedEntries preserves the visible list order', () => {
    const entries = [entry(1, 'a'), entry(2, 'b'), entry(3, 'c')];
    const { result } = renderHook(() => useSelection(entries, 'k'));

    act(() => result.current.set([3, 1]));
    expect(result.current.selectedEntries.map((e) => e.name)).toEqual(['a', 'c']);
  });

  it('clears selection when the context key changes', () => {
    const entries = [entry(1), entry(2)];
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useSelection(entries, key),
      { key: 'folder-a' },
    );

    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(2);

    rerender({ key: 'folder-b' });
    expect(result.current.count).toBe(0);
  });

  it('drops ids that disappear from the visible list on reload', () => {
    const first = [entry(1), entry(2), entry(3)];
    const { result, rerender } = renderHook(
      ({ list }: { list: DriveEntry[] }) => useSelection(list, 'k'),
      { list: first },
    );

    act(() => result.current.set([1, 2, 3]));
    expect(result.current.count).toBe(3);

    // Simulate a reload where id=2 has been deleted server-side.
    rerender({ list: [entry(1), entry(3)] });
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected(2)).toBe(false);
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isSelected(3)).toBe(true);
  });

  it('isIndeterminate flips off when everything is selected', () => {
    const entries = [entry(1), entry(2)];
    const { result } = renderHook(() => useSelection(entries, 'k'));

    act(() => result.current.toggle(1));
    expect(result.current.isIndeterminate).toBe(true);
    expect(result.current.isAllSelected).toBe(false);

    act(() => result.current.toggle(2));
    expect(result.current.isIndeterminate).toBe(false);
    expect(result.current.isAllSelected).toBe(true);
  });
});
