import React from 'react';
import { useI18n } from '@octo/base';
import type { FileTypeFilter } from '../../hooks/useFileList';
import './index.css';

export interface FilterChipsProps {
  value: FileTypeFilter;
  onChange: (next: FileTypeFilter) => void;
}

const OPTIONS: Array<{ key: FileTypeFilter; labelKey: string }> = [
  { key: 'all', labelKey: 'drive.filter.all' },
  { key: 'folder', labelKey: 'drive.filter.folder' },
  { key: 'doc', labelKey: 'drive.filter.doc' },
  { key: 'blob', labelKey: 'drive.filter.blob' },
];

/**
 * Segmented pill selector for the browse-endpoint's `type` filter.
 * Sits in the drive header actions row. Uses --wk-brand-primary as the
 * active fill (not accent purple) so the affordance matches docs' primary-
 * pill idiom, and the chips stay compact enough to share the row with
 * upload / new-folder buttons.
 */
export default function FilterChips({ value, onChange }: FilterChipsProps) {
  const { t } = useI18n();
  return (
    <div className="drive-filter-chips" role="group" aria-label={t('drive.filter.aria')}>
      {OPTIONS.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            className={`drive-filter-chips__chip${active ? ' drive-filter-chips__chip--active' : ''}`}
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
          >
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
