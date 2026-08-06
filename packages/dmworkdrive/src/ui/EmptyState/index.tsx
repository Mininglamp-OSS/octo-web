import React from 'react';
import { useI18n } from '@octo/base';
import { FolderOpen, UploadCloud, Search } from 'lucide-react';
import './index.css';

export interface EmptyStateProps {
  variant: 'folder-empty' | 'folder-empty-readonly' | 'filter-empty';
  onClearFilter?: () => void;
}

/**
 * Non-load empty states for the drive list. Three variants:
 *
 * - `folder-empty`         — user can upload; show a drop-hint and let the
 *                             overlay tell them the rest by demo.
 * - `folder-empty-readonly` — no upload right; quieter phrasing, no CTA.
 * - `filter-empty`         — the current type filter has no matches;
 *                             offer a one-click reset to 'all'.
 *
 * Icons are tokenised (--wk-text-tertiary) so dark theme picks them up.
 */
export default function EmptyState({ variant, onClearFilter }: EmptyStateProps) {
  const { t } = useI18n();
  if (variant === 'filter-empty') {
    return (
      <div className="drive-empty">
        <Search size={40} className="drive-empty__icon" />
        <div className="drive-empty__title">{t('drive.empty.filter.title')}</div>
        <div className="drive-empty__hint">{t('drive.empty.filter.hint')}</div>
        {onClearFilter && (
          <button type="button" className="drive-empty__cta" onClick={onClearFilter}>
            {t('drive.empty.filter.clear')}
          </button>
        )}
      </div>
    );
  }
  if (variant === 'folder-empty') {
    return (
      <div className="drive-empty">
        <UploadCloud size={40} className="drive-empty__icon" />
        <div className="drive-empty__title">{t('drive.empty.folder.title')}</div>
        <div className="drive-empty__hint">{t('drive.empty.folder.hint')}</div>
      </div>
    );
  }
  return (
    <div className="drive-empty">
      <FolderOpen size={40} className="drive-empty__icon" />
      <div className="drive-empty__title">{t('drive.empty.readonly.title')}</div>
    </div>
  );
}
