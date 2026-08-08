import React from 'react';
import { t } from '@octo/base';

export interface ControlBarProps {
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** Server-authoritative capabilities; a false capability greys the control. */
  canShare: boolean;
  canMuteAll: boolean;
  /** During reconnect all controls are greyed (§5). */
  reconnecting: boolean;
  serviceAvailable: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onMuteAll?: () => void;
  onLeave: () => void;
}

/** Button enabled = server capability ∧ not reconnecting ∧ service available (§5). */
export default function ControlBar(props: ControlBarProps) {
  const gate = !props.reconnecting && props.serviceAvailable;
  return (
    <div className="meeting-control-bar" role="toolbar" aria-label={t('meeting.room.participants')}>
      <button type="button" aria-pressed={props.micOn} disabled={!gate} onClick={props.onToggleMic}>
        {t('meeting.prejoin.microphone')}
      </button>
      <button type="button" aria-pressed={props.cameraOn} disabled={!gate} onClick={props.onToggleCamera}>
        {t('meeting.prejoin.camera')}
      </button>
      <button
        type="button"
        aria-pressed={props.sharing}
        disabled={!gate || !props.canShare}
        aria-disabled={!gate || !props.canShare}
        onClick={props.onToggleShare}
      >
        {props.sharing ? t('meeting.room.stopShare') : t('meeting.room.share')}
      </button>
      {props.canMuteAll && (
        <button type="button" disabled={!gate} onClick={props.onMuteAll}>
          {t('meeting.room.muteAll')}
        </button>
      )}
      <button type="button" className="meeting-leave" onClick={props.onLeave}>
        {t('meeting.room.leave')}
      </button>
    </div>
  );
}
