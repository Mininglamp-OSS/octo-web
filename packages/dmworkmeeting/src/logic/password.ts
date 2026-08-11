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
 * the server. Fail-safe against a provisional contract: we only enter cooldown
 * when we can actually time it out (a `retryAtMs` is present) — a cooldown with
 * no retry time would leave the input disabled forever behind a frozen "0s"
 * countdown. A missing `attemptsRemaining` is treated as "unknown, stay on the
 * challenge" rather than 0. A pure reducer so PW-1..4 and the absent-field
 * shapes are exact.
 */
export function reduceWrongPassword(
  server: { attemptsRemaining?: number; retryAtMs?: number; cooldown?: boolean },
): CooldownState {
  const remaining = typeof server.attemptsRemaining === 'number' ? Math.max(0, server.attemptsRemaining) : undefined;
  const wantsCooldown = server.cooldown === true || (remaining !== undefined && remaining <= 0);
  // Never wedge: cooldown requires a retry time we can count down to.
  const inCooldown = wantsCooldown && server.retryAtMs !== undefined;
  return {
    attemptsRemaining: remaining ?? MAX_PASSWORD_ATTEMPTS - 1,
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
