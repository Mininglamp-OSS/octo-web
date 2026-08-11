import React from 'react';
import { t } from '@octo/base';
import type { Meeting } from '../service/contracts';

/** History detail (§8, FD-31). Only exposes whether a password was enabled —
 * never the password itself. */
export default function HistoryDetail({ meeting }: { meeting: Meeting }) {
  return (
    <div className="meeting-history-detail">
      <h2>{meeting.title}</h2>
      <p data-status={meeting.status}>{meeting.status}</p>
      <p>{meeting.passwordEnabled ? t('meeting.history.passwordEnabled') : t('meeting.history.passwordDisabled')}</p>
    </div>
  );
}
