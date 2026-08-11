import React from 'react';
import { t } from '@octo/base';

export interface DevicePreviewProps {
  micOn: boolean;
  cameraOn: boolean;
  /** getUserMedia was denied — join is still allowed with limited media (EX-2). */
  permissionDenied?: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
}

/** PreJoin device preview (§5, §10). Local-only media state; nothing persisted,
 * never reported as business truth, and no LiveKit connection here. */
export default function DevicePreview(props: DevicePreviewProps) {
  return (
    <div className="meeting-device-preview">
      <div className="meeting-preview-video" aria-label={t('meeting.prejoin.camera')} />
      <label>
        <input type="checkbox" checked={props.micOn} onChange={props.onToggleMic} />
        {t('meeting.prejoin.microphone')}
      </label>
      <label>
        <input type="checkbox" checked={props.cameraOn} onChange={props.onToggleCamera} />
        {t('meeting.prejoin.camera')}
      </label>
      {props.permissionDenied && (
        <div role="alert" aria-live="assertive">
          {t('meeting.prejoin.camera')} / {t('meeting.prejoin.microphone')}
        </div>
      )}
    </div>
  );
}
