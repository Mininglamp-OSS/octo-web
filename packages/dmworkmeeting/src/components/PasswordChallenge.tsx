import React, { useEffect, useRef, useState } from 'react';
import { t } from '@octo/base';
import { isValidPasswordFormat } from '../logic/password';

export interface PasswordChallengeProps {
  /** Server-authoritative remaining attempts (shown after a wrong password). */
  attemptsRemaining?: number;
  inCooldown: boolean;
  cooldownRemainingSeconds: number;
  /** Last submission was rejected by the server as incorrect. */
  lastInvalid?: boolean;
  submitting?: boolean;
  onSubmit: (password: string) => void;
}

/**
 * 6-digit password challenge (§8, §11). Format errors are caught locally and do
 * NOT consume a server attempt. All status changes are announced via aria-live;
 * focus stays on the input; submission is disabled during cooldown/submitting.
 */
export default function PasswordChallenge(props: PasswordChallengeProps) {
  const { attemptsRemaining, inCooldown, cooldownRemainingSeconds, lastInvalid, submitting, onSubmit } = props;
  const [value, setValue] = useState('');
  const [formatError, setFormatError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const disabled = inCooldown || submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (!isValidPasswordFormat(value)) {
      setFormatError(true); // FD: format invalid is not counted as an attempt
      inputRef.current?.focus();
      return;
    }
    setFormatError(false);
    onSubmit(value);
  };

  // Priority of the announced status line.
  let status = '';
  if (formatError) status = t('meeting.error.passwordFormatInvalid');
  else if (inCooldown) status = t('meeting.challenge.cooldown', { values: { seconds: cooldownRemainingSeconds } });
  else if (lastInvalid && typeof attemptsRemaining === 'number')
    status = t('meeting.challenge.attemptsRemaining', { values: { count: attemptsRemaining } });

  return (
    <form className="meeting-challenge" onSubmit={handleSubmit} aria-label={t('meeting.challenge.title')}>
      <h2>{t('meeting.challenge.title')}</h2>
      <label htmlFor="meeting-password-input">{t('meeting.challenge.inputLabel')}</label>
      <input
        id="meeting-password-input"
        ref={inputRef}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        pattern="\d{6}"
        placeholder={t('meeting.challenge.placeholder')}
        value={value}
        aria-invalid={formatError || Boolean(lastInvalid)}
        aria-describedby="meeting-password-status"
        disabled={disabled}
        onChange={(e) => {
          setFormatError(false);
          setValue(e.target.value.replace(/[^\d]/g, '').slice(0, 6));
        }}
      />
      <button type="submit" disabled={disabled || value.length !== 6} aria-disabled={disabled || value.length !== 6}>
        {t('meeting.challenge.submit')}
      </button>
      {/* Assertive so screen readers announce attempts/cooldown/format errors immediately. */}
      <div id="meeting-password-status" role="alert" aria-live="assertive">
        {status}
      </div>
    </form>
  );
}
