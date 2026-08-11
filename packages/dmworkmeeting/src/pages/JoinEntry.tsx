import React, { useState } from 'react';
import { t } from '@octo/base';
import { openJoinFlow, parseJoinQuery } from '../state/nav';

/**
 * Join-by-number / join-by-link entry (§4, FD-02). A link may be pasted whole;
 * we parse it with the same `parseJoinQuery` used for cold-load deep links, so a
 * pasted `…/meeting/join?meeting_number=123` resolves to the number rather than
 * being sent verbatim. A bare input must be a numeric meeting number. Passwords
 * are never entered here — the challenge only appears after evaluate returns
 * password_required.
 */
export default function JoinEntry() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    setError(undefined);

    // If a full URL/link was pasted, resolve its credential via the shared parser.
    try {
      const u = new URL(raw);
      const creds = parseJoinQuery(u.search);
      if (creds) {
        openJoinFlow(creds);
        return;
      }
    } catch {
      // Not a URL — fall through to bare-number handling.
    }

    // A bare input must be a numeric meeting number.
    if (!/^\d+$/.test(raw)) {
      setError(t('meeting.error.credentialInvalid'));
      return;
    }
    openJoinFlow({ source: 'number', meetingNumber: raw });
  };

  return (
    <form className="meeting-join-entry" onSubmit={submit} aria-label={t('meeting.home.join')}>
      <label htmlFor="meeting-join-input">{t('meeting.join.numberLabel')}</label>
      <input
        id="meeting-join-input"
        value={value}
        placeholder={t('meeting.join.numberPlaceholder')}
        aria-invalid={Boolean(error)}
        onChange={(e) => {
          setError(undefined);
          setValue(e.target.value);
        }}
      />
      <button type="submit" disabled={!value.trim()}>
        {t('meeting.join.submit')}
      </button>
      {error && (
        <div role="alert" aria-live="assertive">
          {error}
        </div>
      )}
    </form>
  );
}
