import React from 'react';
import { t } from '@octo/base';
import { MeetingErrorCode } from '../service/errors';

export type TerminalReason =
  | 'ended'
  | 'cancelled'
  | 'removed'
  | 'superseded'
  | 'left'
  | 'noShow'
  | 'emptyTimeout'
  | 'authRequired';

const CODE_TO_REASON: Partial<Record<MeetingErrorCode, TerminalReason>> = {
  [MeetingErrorCode.ENDED]: 'ended',
  [MeetingErrorCode.CANCELLED]: 'cancelled',
  [MeetingErrorCode.REMOVED]: 'removed',
};

export function reasonForCode(code: MeetingErrorCode): TerminalReason {
  return CODE_TO_REASON[code] ?? 'ended';
}

export interface TerminalProps {
  reason: TerminalReason;
  onBackHome?: () => void;
}

/** Terminal overlay (§4, §7). Never black-screens; offers a way back. */
export default function Terminal({ reason, onBackHome }: TerminalProps) {
  return (
    <div className="meeting-terminal" role="status" aria-live="polite">
      <p>{t(`meeting.terminal.${reason}`)}</p>
      {onBackHome && (
        <button type="button" onClick={onBackHome}>
          {t('meeting.terminal.backHome')}
        </button>
      )}
    </div>
  );
}
