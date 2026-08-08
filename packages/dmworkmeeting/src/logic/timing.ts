// Server-authoritative time boundaries, encoded as pure functions with injected
// clocks so E2E/unit assertions are exact. The frontend never derives these
// verdicts at runtime from a client clock — it renders the server's decision;
// these mirror the contract for deterministic tests (§9, §12, B-2/B-3/B-4).

// ── B-2: early-join window (MEETING_EARLY_JOIN_WINDOW_SECONDS = 600). ──
export const EARLY_JOIN_WINDOW_SECONDS = 600;

/** earliest_join_at = scheduled_start_at - 600s. */
export function earliestJoinAtMs(scheduledStartAtMs: number): number {
  return scheduledStartAtMs - EARLY_JOIN_WINDOW_SECONDS * 1000;
}

/** True when the server would return TOO_EARLY. Asserted at 601s (too early) and
 * 599s (allowed) before scheduled start. */
export function isTooEarly(scheduledStartAtMs: number, serverNowMs: number): boolean {
  return serverNowMs < earliestJoinAtMs(scheduledStartAtMs);
}

// ── B-3: reconnect grace (MEETING_RECONNECT_GRACE_SECONDS = 15). ──
export const RECONNECT_GRACE_SECONDS = 15;

/**
 * Same-endpoint reconnect within grace reuses the original segment and is exempt
 * from the password. The clock origin is the server-authoritative
 * `segment.leave_at`; the client clock and LiveKit `participant_left` webhook
 * arrival are NOT authoritative. Requires the same device_id_hash. Asserted at
 * 14.9s (exempt) and 15.1s (re-evaluate).
 */
export function isWithinReconnectGrace(args: {
  leaveAtMs: number | undefined;
  serverNowMs: number;
  originalDeviceIdHash: string | undefined;
  currentDeviceIdHash: string;
}): boolean {
  const { leaveAtMs, serverNowMs, originalDeviceIdHash, currentDeviceIdHash } = args;
  if (leaveAtMs === undefined) return false; // unknown leave_at → re-evaluate
  if (!originalDeviceIdHash || originalDeviceIdHash !== currentDeviceIdHash) return false; // new endpoint → re-evaluate
  return serverNowMs - leaveAtMs <= RECONNECT_GRACE_SECONDS * 1000;
}

// ── B-4: empty-room / no-show timeout (MEETING_EMPTY_TIMEOUT_SECONDS = 300). ──
export const EMPTY_TIMEOUT_SECONDS = 300;

/**
 * Empty-room timeout is anchored to the server's `empty_since` (written under a
 * lock; LiveKit webhooks are reconciliation only). The frontend/E2E must NOT
 * derive "online = 0" from client-side participant counts. Returns whether the
 * timeout has elapsed given the server anchor.
 */
export function isEmptyTimeoutElapsed(emptySinceMs: number | undefined, serverNowMs: number): boolean {
  if (emptySinceMs === undefined) return false;
  return serverNowMs - emptySinceMs >= EMPTY_TIMEOUT_SECONDS * 1000;
}

// ── Reminder window (E2E-2, 15 min). ──
export const REMINDER_WINDOW_SECONDS = 900;
export function isWithinReminderWindow(scheduledStartAtMs: number, serverNowMs: number): boolean {
  const delta = scheduledStartAtMs - serverNowMs;
  return delta <= REMINDER_WINDOW_SECONDS * 1000 && delta > 0;
}
