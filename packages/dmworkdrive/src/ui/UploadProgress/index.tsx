import React from 'react';
import { useI18n } from '@octo/base';
import { Button, Progress } from '@douyinfe/semi-ui';
import { CheckCircle2, AlertCircle, X, RotateCw } from 'lucide-react';
import type { UploadItem } from '../../hooks/useUpload';
import { formatBytes } from '../../utils/format';
import './index.css';

export interface UploadProgressProps {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * In-flight upload panel — one row per file with a progress bar, mirroring the
 * chat composer's upload feedback. Successful rows auto-dismiss shortly after
 * finishing (see useUpload); failed rows stay until dismissed and expose a
 * retry action.
 */
export default function UploadProgress({ items, onRetry, onDismiss }: UploadProgressProps) {
  const { t } = useI18n();
  if (!items.length) return null;

  const label: Record<UploadItem['status'], string> = {
    preparing: t('drive.upload.preparing'),
    uploading: t('drive.upload.uploading'),
    confirming: t('drive.upload.confirming'),
    done: t('drive.upload.done'),
    error: t('drive.upload.failed'),
  };

  return (
    <div className="drive-upload-panel">
      {items.map((item) => (
        <div key={item.id} className="drive-upload-item" data-status={item.status}>
          <div className="drive-upload-item__main">
            <span className="drive-upload-item__name" title={item.name}>
              {item.name}
            </span>
            <span className="drive-upload-item__meta">
              {item.status === 'done' && <CheckCircle2 size={14} className="drive-upload-item__ok" />}
              {item.status === 'error' && <AlertCircle size={14} className="drive-upload-item__err" />}
              {item.status === 'error' ? item.error || label.error : label[item.status]}
              {item.status !== 'error' && item.status !== 'done' && (
                <span className="drive-upload-item__size">{formatBytes(item.size)}</span>
              )}
            </span>
          </div>

          {item.status === 'uploading' && (
            <Progress percent={item.progress} size="small" aria-label={label.uploading} />
          )}

          <div className="drive-upload-item__ops">
            {item.status === 'error' && (
              <Button
                theme="borderless"
                type="tertiary"
                size="small"
                icon={<RotateCw size={14} />}
                aria-label={t('drive.upload.retry')}
                onClick={() => onRetry(item.id)}
              >
                {t('drive.upload.retry')}
              </Button>
            )}
            {(item.status === 'done' || item.status === 'error') && (
              <Button
                theme="borderless"
                type="tertiary"
                size="small"
                icon={<X size={14} />}
                aria-label={t('drive.upload.dismiss')}
                onClick={() => onDismiss(item.id)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
