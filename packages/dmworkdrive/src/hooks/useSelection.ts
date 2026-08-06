import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DriveEntry } from '../bridge/types';

/**
 * Multi-select state for a listing. Backed by a Set of entry ids and
 * intentionally decoupled from useFileList — the caller passes the current
 * visible entries in so this hook can offer selectAll / clear helpers without
 * knowing where the list came from.
 *
 * Selection is scoped to a "context key" (typically `${spaceId}::${parentId}`).
 * When the caller navigates to a different folder / space it should pass a new
 * key, and the selection auto-clears — carrying selection across folders
 * would leak stale ids into a listing they don't belong to.
 */
export interface UseSelectionResult {
  /** Currently selected entry ids. */
  selected: ReadonlySet<number>;
  /** Number of selected items. */
  count: number;
  /** Convenience: `count > 0`. */
  hasSelection: boolean;
  /** `true` when every visible entry is selected. */
  isAllSelected: boolean;
  /** `true` when some (but not all) visible entries are selected. */
  isIndeterminate: boolean;
  /** Whether a specific id is selected. */
  isSelected: (id: number) => boolean;
  /** Toggle one id. */
  toggle: (id: number) => void;
  /** Replace the selection wholesale. */
  set: (ids: Iterable<number>) => void;
  /** Toggle all visible: if all selected → clear, else → select all visible. */
  toggleAll: () => void;
  /** Clear the selection. */
  clear: () => void;
  /** Resolve the selected entries in the CURRENT visible list, in list order. */
  selectedEntries: DriveEntry[];
}

export function useSelection(
  visibleEntries: DriveEntry[],
  contextKey: string | null,
): UseSelectionResult {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  // Reset selection when the context (folder / space) changes. Also on the
  // no-context transition so the batch bar doesn't linger between spaces.
  useEffect(() => {
    setSelected(new Set());
  }, [contextKey]);

  // If entries reload (e.g. after delete / move) drop any ids that no longer
  // exist in the visible list — otherwise the count in the bulk bar keeps
  // showing removed rows.
  useEffect(() => {
    if (selected.size === 0) return;
    const visibleIds = new Set(visibleEntries.map((e) => e.id));
    let changed = false;
    const next = new Set<number>();
    selected.forEach((id) => {
      if (visibleIds.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEntries]);

  const isSelected = useCallback((id: number) => selected.has(id), [selected]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const set = useCallback((ids: Iterable<number>) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isAllSelected = useMemo(() => {
    if (visibleEntries.length === 0) return false;
    return visibleEntries.every((e) => selected.has(e.id));
  }, [visibleEntries, selected]);

  const isIndeterminate = useMemo(() => {
    return selected.size > 0 && !isAllSelected;
  }, [selected, isAllSelected]);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (visibleEntries.length === 0) return prev;
      const allSelected = visibleEntries.every((e) => prev.has(e.id));
      if (allSelected) return new Set();
      return new Set(visibleEntries.map((e) => e.id));
    });
  }, [visibleEntries]);

  const selectedEntries = useMemo(
    () => visibleEntries.filter((e) => selected.has(e.id)),
    [visibleEntries, selected],
  );

  return {
    selected,
    count: selected.size,
    hasSelection: selected.size > 0,
    isAllSelected,
    isIndeterminate,
    isSelected,
    toggle,
    set,
    toggleAll,
    clear,
    selectedEntries,
  };
}
