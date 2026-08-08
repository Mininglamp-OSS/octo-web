import { describe, it, expect } from 'vitest';
import {
  isValidPasswordFormat,
  reduceWrongPassword,
  cooldownRemainingSeconds,
  isCooldownExpired,
  clearedCooldownState,
  initialCooldownState,
  MAX_PASSWORD_ATTEMPTS,
  PASSWORD_COOLDOWN_SECONDS,
} from './password';

describe('password format (FD-24, PW-5)', () => {
  it.each(['000000', '123456', '999999'])('accepts 6 digits: %s', (v) => {
    expect(isValidPasswordFormat(v)).toBe(true);
  });
  it.each(['12345', '1234567', 'abcdef', '12 456', '', '12a456'])('rejects non-6-digit: %s', (v) => {
    expect(isValidPasswordFormat(v)).toBe(false);
  });
});

describe('cooldown reducer (FD-28, PW-1..4)', () => {
  it('attempts 1..4 stay retriable (no cooldown)', () => {
    for (const remaining of [4, 3, 2, 1]) {
      const s = reduceWrongPassword({ attemptsRemaining: remaining });
      expect(s.inCooldown).toBe(false);
      expect(s.attemptsRemaining).toBe(remaining);
    }
  });

  it('the 5th failure (0 remaining) enters cooldown with retry_at', () => {
    const retryAtMs = 1_000 + PASSWORD_COOLDOWN_SECONDS * 1000;
    const s = reduceWrongPassword({ attemptsRemaining: 0, retryAtMs, cooldown: true });
    expect(s.inCooldown).toBe(true);
    expect(s.retryAtMs).toBe(retryAtMs);
  });

  it('server cooldown flag forces cooldown even if remaining reported > 0', () => {
    const s = reduceWrongPassword({ attemptsRemaining: 2, cooldown: true, retryAtMs: 9999 });
    expect(s.inCooldown).toBe(true);
  });

  it('MAX attempts constant is 5', () => {
    expect(MAX_PASSWORD_ATTEMPTS).toBe(5);
    expect(initialCooldownState().attemptsRemaining).toBe(4);
  });
});

describe('cooldown clock (deterministic, 5 min)', () => {
  const nowMs = 1_000_000;
  const state = { attemptsRemaining: 0, inCooldown: true, retryAtMs: nowMs + 300_000 };

  it('reports remaining seconds', () => {
    expect(cooldownRemainingSeconds(state, nowMs)).toBe(300);
    expect(cooldownRemainingSeconds(state, nowMs + 299_000)).toBe(1);
  });

  it('expires exactly at retry_at and clears atomically', () => {
    expect(isCooldownExpired(state, nowMs + 299_999)).toBe(false);
    expect(isCooldownExpired(state, nowMs + 300_000)).toBe(true);
    const cleared = clearedCooldownState();
    expect(cleared.inCooldown).toBe(false);
    expect(cleared.attemptsRemaining).toBe(4);
  });
});
