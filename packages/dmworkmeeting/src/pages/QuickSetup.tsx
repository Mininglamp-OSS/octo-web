import React, { useRef, useState } from 'react';
import { t } from '@octo/base';
import { MeetingApiClient, newIdempotencyKey } from '../service/MeetingApiClient';
import { isValidPasswordFormat } from '../logic/password';

/**
 * Quick meeting setup (§4). quick-create uses ONE explicit Idempotency-Key
 * reused across retries (N3, FD-11); the button single-flights to prevent
 * double submits. Optional 6-digit password validated locally.
 */
export default function QuickSetup({ onCreated }: { onCreated?: (meetingId: string) => void }) {
  const [title, setTitle] = useState('');
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  // Stable across retries so a duplicate click returns the first result.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  const create = async () => {
    if (submitting) return;
    if (passwordEnabled && !isValidPasswordFormat(password)) {
      setError(t('meeting.error.passwordFormatInvalid'));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const meeting = await MeetingApiClient.quickCreate(
        { title: title || undefined, passwordEnabled, password: passwordEnabled ? password : undefined },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      onCreated?.(meeting.meetingId);
    } catch {
      setError(t('meeting.error.internal'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="meeting-quick-setup">
      <h2>{t('meeting.home.quick')}</h2>
      <input aria-label={t('meeting.home.title')} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label>
        <input type="checkbox" checked={passwordEnabled} onChange={(e) => setPasswordEnabled(e.target.checked)} />
        {t('meeting.error.passwordRequired')}
      </label>
      {passwordEnabled && (
        <input
          aria-label={t('meeting.challenge.inputLabel')}
          inputMode="numeric"
          maxLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        />
      )}
      <button type="button" disabled={submitting} aria-disabled={submitting} onClick={create}>
        {t('meeting.prejoin.join')}
      </button>
      {error && (
        <div role="alert" aria-live="assertive">
          {error}
        </div>
      )}
    </div>
  );
}
