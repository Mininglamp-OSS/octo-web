import React from 'react';
import { useI18n } from '@octo/base';
import { UploadCloud } from 'lucide-react';
import './index.css';

export interface DropzoneOverlayProps {
  /** Visible when true; the surrounding drop zone should provide the drag
   *  handlers via useDropzone. */
  active: boolean;
  /** Human-readable name of the current folder, shown as the target. */
  targetName?: string;
}

/**
 * Visual overlay shown on top of the file list while the user is dragging
 * OS files into the drive body. Pointer-events are disabled so the drag
 * event stream still hits the underlying drop zone.
 *
 * `active` toggles a class rather than mounting/unmounting so the fade
 * animation can run in both directions.
 */
export default function DropzoneOverlay({ active, targetName }: DropzoneOverlayProps) {
  const { t } = useI18n();
  return (
    <div
      className={`drive-dropzone-overlay${active ? ' drive-dropzone-overlay--active' : ''}`}
      aria-hidden={!active}
    >
      <div className="drive-dropzone-overlay__inner">
        <div className="drive-dropzone-overlay__icon">
          <UploadCloud size={40} />
        </div>
        <div className="drive-dropzone-overlay__title">{t('drive.upload.dropTitle')}</div>
        {targetName && (
          <div className="drive-dropzone-overlay__target" title={targetName}>
            {targetName}
          </div>
        )}
      </div>
    </div>
  );
}
