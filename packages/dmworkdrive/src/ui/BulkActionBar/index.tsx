import React from 'react';
import { useI18n } from '@octo/base';
import { Button } from '@douyinfe/semi-ui';
import { Trash2, ArrowRight, Download, X } from 'lucide-react';
import './index.css';

export interface BulkActionBarProps {
  /** Number of items currently selected. Zero → renders nothing. */
  count: number;
  /** Deletion allowed (editor+ role). */
  canEdit: boolean;
  /** Download allowed (downloader+ role). */
  canDownload: boolean;
  /** Any batch op still in progress — buttons become disabled. */
  busy?: boolean;
  onDelete: () => void;
  onMove: () => void;
  onDownload: () => void;
  onClear: () => void;
}

/**
 * Selection-context batch action bar. Rendered inside DriveContent's header
 * region — replacing the breadcrumb + toolbar while `count > 0` — so the
 * active batch is visually focused and the header actions don't compete for
 * click targets. When `count === 0`, this component returns null and the
 * normal header comes back.
 *
 * Buttons follow docs' filter-btn / list-new pill specs already used by
 * .drive-btn / .drive-btn--primary, but at bulk-bar's compact 28px height.
 */
export default function BulkActionBar({
  count,
  canEdit,
  canDownload,
  busy = false,
  onDelete,
  onMove,
  onDownload,
  onClear,
}: BulkActionBarProps) {
  const { t } = useI18n();
  if (count <= 0) return null;

  return (
    <div className="drive-bulk-bar" role="toolbar" aria-label={t('drive.bulk.title')}>
      <div className="drive-bulk-bar__count">
        <b>{t('drive.bulk.selected', { values: { count: String(count) } })}</b>
      </div>
      <div className="drive-bulk-bar__actions">
        {canDownload && (
          <Button
            className="drive-bulk-bar__btn"
            icon={<Download size={14} />}
            disabled={busy}
            onClick={onDownload}
          >
            {t('drive.bulk.download')}
          </Button>
        )}
        {canEdit && (
          <Button
            className="drive-bulk-bar__btn"
            icon={<ArrowRight size={14} />}
            disabled={busy}
            onClick={onMove}
          >
            {t('drive.bulk.move')}
          </Button>
        )}
        {canEdit && (
          <Button
            className="drive-bulk-bar__btn drive-bulk-bar__btn--danger"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={onDelete}
          >
            {t('drive.bulk.delete')}
          </Button>
        )}
        <Button
          className="drive-bulk-bar__btn drive-bulk-bar__btn--dismiss"
          icon={<X size={14} />}
          onClick={onClear}
          aria-label={t('drive.bulk.clear')}
        />
      </div>
    </div>
  );
}
