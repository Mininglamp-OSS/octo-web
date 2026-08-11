import React, { useRef, useState } from 'react';
import { t } from '@octo/base';
import { MeetingApiClient, newIdempotencyKey } from '../service/MeetingApiClient';
import type { Meeting } from '../service/contracts';
import { isValidPasswordFormat } from '../logic/password';
import { classifyFailure } from '../service/failClosed';
import { directiveForCode } from '../service/errors';

export interface SchedulePageProps {
  /** When present the form edits an existing meeting (PATCH with If-Match). */
  existing?: Meeting;
  onSaved?: (meeting: Meeting) => void;
  onCancelled?: () => void;
}

// A `datetime-local` input yields local wall-clock "YYYY-MM-DDTHH:mm". Convert
// a stored UTC ISO string into that local form for prefill, and convert the
// local input back to a UTC ISO instant for the wire (contract: UTC ISO-8601).
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local); // parsed in local time
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Schedule / edit / cancel (§4, FD-08/FD-12). Edits are optimistic-concurrency
 * guarded with If-Match=version; a MEETING_VERSION_CONFLICT surfaces a refetch
 * prompt. Password edits are disabled once the meeting is live (IMMUTABLE).
 * Times are sent as UTC ISO-8601 (the input is local wall-clock).
 */
export default function SchedulePage({ existing, onSaved, onCancelled }: SchedulePageProps) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [startAt, setStartAt] = useState(isoToLocalInput(existing?.scheduledStartAt));
  const [passwordEnabled, setPasswordEnabled] = useState(Boolean(existing?.passwordEnabled));
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  const passwordLocked = existing?.status === 'live'; // IMMUTABLE after live

  const save = async () => {
    if (submitting) return;
    // Editing may keep the existing time; a new schedule must provide one.
    const startIso = startAt ? localInputToIso(startAt) : existing?.scheduledStartAt ?? null;
    if (!startIso) {
      setError(t('meeting.error.timeInvalid'));
      return;
    }
    // A new password-protected meeting must supply a valid 6-digit password.
    // On edit, an empty field means "leave the existing password unchanged".
    if (passwordEnabled && !passwordLocked) {
      const mustHavePassword = !existing;
      if ((mustHavePassword || password) && !isValidPasswordFormat(password)) {
        setError(t('meeting.error.passwordFormatInvalid'));
        return;
      }
    }
    setSubmitting(true);
    setError(undefined);
    try {
      let meeting: Meeting;
      if (existing) {
        meeting = await MeetingApiClient.patchMeeting(
          existing.meetingId,
          {
            title,
            scheduledStartAt: startIso,
            passwordEnabled: passwordLocked ? undefined : passwordEnabled,
            password: passwordLocked || !passwordEnabled ? undefined : password || undefined,
          },
          { ifMatch: existing.version, idempotencyKey: idempotencyKeyRef.current },
        );
        idempotencyKeyRef.current = newIdempotencyKey(); // rotate after a successful edit
      } else {
        meeting = await MeetingApiClient.scheduleCreate(
          { title, scheduledStartAt: startIso, passwordEnabled, password: passwordEnabled ? password : undefined },
          { idempotencyKey: idempotencyKeyRef.current },
        );
        idempotencyKeyRef.current = newIdempotencyKey(); // rotate after a successful create
      }
      onSaved?.(meeting);
    } catch (err) {
      const code = classifyFailure(err).code;
      setError(code ? t(directiveForCode(code).i18nKey) : t('meeting.error.internal'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!existing || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await MeetingApiClient.cancelMeeting(existing.meetingId, { ifMatch: existing.version, idempotencyKey: newIdempotencyKey() });
      onCancelled?.();
    } catch (err) {
      const code = classifyFailure(err).code;
      setError(code ? t(directiveForCode(code).i18nKey) : t('meeting.error.internal'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="meeting-schedule">
      <h2>{existing ? t('meeting.form.editTitle') : t('meeting.home.schedule')}</h2>
      <label>
        {t('meeting.form.titleLabel')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {t('meeting.form.startLabel')}
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </label>
      <label>
        <input
          type="checkbox"
          checked={passwordEnabled}
          disabled={passwordLocked}
          aria-disabled={passwordLocked}
          onChange={(e) => setPasswordEnabled(e.target.checked)}
        />
        {t('meeting.form.enablePassword')}
      </label>
      {passwordEnabled && !passwordLocked && (
        <input
          aria-label={t('meeting.challenge.inputLabel')}
          inputMode="numeric"
          maxLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        />
      )}
      <div className="meeting-schedule-actions">
        <button type="button" disabled={submitting} onClick={save}>
          {t('meeting.form.save')}
        </button>
        {existing && (
          <button type="button" disabled={submitting} onClick={cancel}>
            {t('meeting.form.cancelMeeting')}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" aria-live="assertive">
          {error}
        </div>
      )}
    </div>
  );
}
