import React from 'react';
import { t } from '@octo/base';

export type ServiceUnavailableReason = 'service-unavailable' | 'gateway-missing';

export interface ServiceUnavailableProps {
  reason: ServiceUnavailableReason;
  /** Seconds until an automatic retry is allowed (service-unavailable only). */
  retryAfter?: number;
  onRetry?: () => void;
}

/**
 * Fail-closed service state (§6.2, §14). A missing gateway route ("feature not
 * enabled") is distinct from a temporarily-unavailable service; neither is ever
 * shown as "meeting does not exist".
 */
export default function ServiceUnavailable({ reason, retryAfter, onRetry }: ServiceUnavailableProps) {
  const message = reason === 'gateway-missing' ? t('meeting.service.notEnabled') : t('meeting.service.unavailable');
  return (
    <div className="meeting-service-unavailable" role="alert" aria-live="polite">
      <p>{message}</p>
      {reason === 'service-unavailable' && onRetry && (
        <button type="button" onClick={onRetry}>
          {retryAfter ? `${t('meeting.service.retry')} (${retryAfter}s)` : t('meeting.service.retry')}
        </button>
      )}
    </div>
  );
}
