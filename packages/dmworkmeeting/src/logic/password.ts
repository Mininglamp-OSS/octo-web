// Password format + attempt/cooldown state (§8, FD-24, FD-28). All time is
// injected so tests are deterministic; the server remains authoritative for
// attempts_remaining / retry_at (the frontend mirrors, never invents).

export const PASSWORD_PATTERN = /^\d{6}$/;
export const MAX_PASSWORD_ATTEMPTS = 5; // 1-4 retriable; the 5th enters cooldown
export const PASSWORD_COOLDOWN_SECONDS = 300; // 5 minutes

/** Frontend pre-check mirroring the prototype `submitPassword` guard. A format
 * failure is surfaced locally and does NOT consume a server attempt. */
export function isValidPasswordFormat(input: string): boolean {
  return PASSWORD_PATTERN.test(input);
}

export interface CooldownState {
  /** Server-authoritative remaining attempts before cooldown. */
  attemptsRemaining: number;
  inCooldown: boolean;
  /** Epoch ms when cooldown ends (mirrors server retry_at). */
  retryAtMs?: number;
}

export const initialCooldownState = (): CooldownState => ({
  attemptsRemaining: MAX_PASSWORD_ATTEMPTS - 1, // attempts left AFTER the current one is available
  inCooldown: false,
});

/**
 * Reduce a wrong-password result. `attemptsRemaining` and `retryAtMs` come from
 * the server; when the server reports 0 remaining (the 5th failure) we enter
 * cooldown. A pure reducer so PW-1..4 (retriable) and PW-4→cooldown are exact.
 */
export function reduceWrongPassword(
  server: { attemptsRemaining: number; retryAtMs?: number; cooldown?: boolean },
): CooldownState {
  const inCooldown = server.cooldown === true || server.attemptsRemaining <= 0;
  return {
    attemptsRemaining: Math.max(0, server.attemptsRemaining),
    inCooldown,
    retryAtMs: inCooldown ? server.retryAtMs : undefined,
  };
}

/** Cooldown clears atomically on expiry (or on a successful verify). Deterministic
 * via injected `nowMs`. Returns remaining seconds (ceil) and whether it cleared. */
export function cooldownRemainingSeconds(state: CooldownState, nowMs: number): number {
  if (!state.inCooldown || state.retryAtMs === undefined) return 0;
  return Math.max(0, Math.ceil((state.retryAtMs - nowMs) / 1000));
}

export function isCooldownExpired(state: CooldownState, nowMs: number): boolean {
  if (!state.inCooldown || state.retryAtMs === undefined) return false;
  return nowMs >= state.retryAtMs;
}

/** On expiry/success the counter resets atomically (FD-28). */
export function clearedCooldownState(): CooldownState {
  return initialCooldownState();
}
