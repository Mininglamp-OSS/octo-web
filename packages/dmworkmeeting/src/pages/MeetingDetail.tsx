import React, { useEffect, useState } from 'react';
import { t } from '@octo/base';
import { MeetingApiClient } from '../service/MeetingApiClient';
import type { Meeting } from '../service/contracts';
import { classifyFailure } from '../service/failClosed';
import { directiveForCode } from '../service/errors';
import { openJoinFlow, openEdit, backToHome } from '../state/nav';

/**
 * Meeting detail (§4, credential surface). Shows the meeting number and join
 * link with copy affordances (the only place a creator obtains the credential),
 * plus Join / Edit / Cancel entries. History detail only exposes whether a
 * password was enabled, never the password itself (FD-31).
 */
export default function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<Meeting>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    MeetingApiClient.getMeeting(meetingId, controller.signal)
      .then(setMeeting)
      .catch((err) => {
        const code = classifyFailure(err).code;
        setError(code ? t(directiveForCode(code).i18nKey) : t('meeting.error.internal'));
      });
    return () => controller.abort();
  }, [meetingId]);

  const copy = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(label);
    } catch {
      // Clipboard denied — leave the value visible for manual copy.
    }
  };

  if (error) {
    return (
      <div className="meeting-detail" role="alert" aria-live="assertive">
        <p>{error}</p>
        <button type="button" onClick={backToHome}>
          {t('meeting.terminal.backHome')}
        </button>
      </div>
    );
  }
  if (!meeting) return <p role="status" aria-busy="true">…</p>;

  return (
    <div className="meeting-detail">
      <h2>{meeting.title}</h2>
      <p data-status={meeting.status}>{meeting.status}</p>
      {meeting.meetingNumber && (
        <div className="meeting-credential">
          <span>{t('meeting.detail.number')}: {meeting.meetingNumber}</span>
          <button type="button" onClick={() => void copy('number', meeting.meetingNumber)}>
            {t('meeting.detail.copyNumber')}
          </button>
        </div>
      )}
      {meeting.joinLink && (
        <div className="meeting-credential">
          <button type="button" onClick={() => void copy('link', meeting.joinLink)}>
            {t('meeting.detail.copyLink')}
          </button>
        </div>
      )}
      <p>{meeting.passwordEnabled ? t('meeting.history.passwordEnabled') : t('meeting.history.passwordDisabled')}</p>
      {copied && (
        <div role="status" aria-live="polite">
          {t('meeting.detail.copied')}
        </div>
      )}
      <div className="meeting-detail-actions">
        <button type="button" onClick={() => openJoinFlow({ source: 'list', meetingId })}>
          {t('meeting.home.join')}
        </button>
        {(meeting.status === 'scheduled') && (
          <button type="button" onClick={() => openEdit(meetingId)}>
            {t('meeting.detail.edit')}
          </button>
        )}
      </div>
    </div>
  );
}
