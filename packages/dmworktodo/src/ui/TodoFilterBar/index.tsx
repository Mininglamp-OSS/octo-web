import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useI18n } from '@octo/base';
import type { MatterListParams, MatterStatus } from '../../bridge/types';
import './index.css';

export interface MatterFilterBarProps {
  filters: MatterListParams;
  onFilterChange: (filters: Partial<MatterListParams>) => void;
  searchOnly?: boolean;
}

const STATUS_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'todo.tabs.all' },
  { value: 'open', labelKey: 'todo.status.pending' },
  { value: 'done', labelKey: 'todo.status.done' },
  { value: 'archived', labelKey: 'todo.status.archived' },
];

export default function MatterFilterBar({ filters, onFilterChange, searchOnly = false }: MatterFilterBarProps) {
  const { t } = useI18n();
  const [localSearch, setLocalSearch] = useState(filters.q || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external filter changes back to local state
  useEffect(() => {
    setLocalSearch(filters.q || '');
  }, [filters.q]);

  const handleStatusChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onFilterChange({ status: (value || undefined) as MatterStatus | undefined });
    },
    [onFilterChange],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ q: value || undefined });
      }, 300);
    },
    [onFilterChange],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="wk-matter-filter-bar">
      {!searchOnly && (
        <select
          className="wk-matter-filter-bar__select"
          value={filters.status || ''}
          onChange={handleStatusChange}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      )}
      <input
        className="wk-matter-filter-bar__search"
        type="text"
        placeholder={t("todo.filter.searchPlaceholder")}
        value={localSearch}
        onChange={handleSearchChange}
      />
    </div>
  );
}

export { MatterFilterBar };
