import { useEffect, useState } from 'react';
import { cooldownRemainingSeconds, isCooldownExpired, type CooldownState } from '../logic/password';

export interface UseCooldownClockResult {
  remainingSeconds: number;
  expired: boolean;
}

/**
 * Ticks a password cooldown down to zero. `now` is injectable so tests are
 * deterministic; production passes Date.now. The authoritative retry_at comes
 * from the server (mirrored into `state`); this only drives the countdown UI.
 */
export function useCooldownClock(
  state: CooldownState,
  onExpired?: () => void,
  now: () => number = () => Date.now(),
): UseCooldownClockResult {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!state.inCooldown) return undefined;
    const id = setInterval(() => setTick((n: number) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state.inCooldown, state.retryAtMs]);

  const nowMs = now();
  const remainingSeconds = cooldownRemainingSeconds(state, nowMs);
  const expired = isCooldownExpired(state, nowMs);

  useEffect(() => {
    if (expired) onExpired?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, tick]);

  return { remainingSeconds, expired };
}
