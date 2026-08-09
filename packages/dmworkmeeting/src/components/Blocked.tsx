import React from 'react';
import { t } from '@octo/base';
import { directiveForCode, MeetingErrorCode, isMeetingErrorCode } from '../service/errors';

export interface BlockedProps {
  code: MeetingErrorCode;
  /** Optional detail interpolated into the message (e.g. earliest join time). */
  values?: Record<string, string | number>;
  onRetry?: () => void;
  onBackHome?: () => void;
}

/**
 * Recoverable non-terminal error view (§6.4). Renders the directive's exact
 * message for locked / full / too-early / rate-limited / version-conflict /
 * credential-invalid / not-same-space / forbidden / network, and offers a
 * bounded retry when the directive is retriable. Never renders as "ended".
 */
export default function Blocked({ code, values, onRetry, onBackHome }: BlockedProps) {
  // Fail-safe against a snapshot that may add codes not yet in the table.
  const directive = directiveForCode(isMeetingErrorCode(code) ? code : MeetingErrorCode.INTERNAL);
  return (
    <div className="meeting-blocked" role="alert" aria-live="assertive" data-code={code}>
      <p>{t(directive.i18nKey, values ? { values } : undefined)}</p>
      {directive.retriable && onRetry && (
        <button type="button" onClick={onRetry}>
          {t('meeting.service.retry')}
        </button>
      )}
      {onBackHome && (
        <button type="button" onClick={onBackHome}>
          {t('meeting.terminal.backHome')}
        </button>
      )}
    </div>
  );
}
