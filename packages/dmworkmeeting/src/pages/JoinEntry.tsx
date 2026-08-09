import React, { useState } from 'react';
import { t } from '@octo/base';
import { openJoinFlow, deviceIdHash } from '../state/nav';

/**
 * Join-by-number / join-by-link entry (§4, FD-02). A link may be pasted whole;
 * we extract link_token from its query. Passwords are never entered here — the
 * challenge only appears after evaluate returns password_required.
 */
export default function JoinEntry() {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    // If a full URL/link was pasted, prefer its link_token.
    let linkToken: string | undefined;
    try {
      const u = new URL(raw);
      linkToken = u.searchParams.get('link_token') ?? undefined;
    } catch {
      linkToken = undefined;
    }
    if (linkToken) {
      openJoinFlow({ source: 'link', linkToken }, deviceIdHash());
    } else {
      openJoinFlow({ source: 'number', meetingNumber: raw }, deviceIdHash());
    }
  };

  return (
    <form className="meeting-join-entry" onSubmit={submit} aria-label={t('meeting.home.join')}>
      <label htmlFor="meeting-join-input">{t('meeting.join.numberLabel')}</label>
      <input
        id="meeting-join-input"
        value={value}
        placeholder={t('meeting.join.numberPlaceholder')}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" disabled={!value.trim()}>
        {t('meeting.join.submit')}
      </button>
    </form>
  );
}
