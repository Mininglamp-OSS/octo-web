// Deterministic admission oracle (frontend appendix §7, FD-27 / S-1 / N1 / FD-32).
//
// evaluate and finalize run the SAME oracle. The frontend NEVER infers meeting
// status or the admission verdict locally at runtime — this pure function exists
// to (a) drive deterministic unit tests that mirror the server contract, and
// (b) render the correct terminal/challenge/prejoin state from the server's
// verdict. The server remains the source of truth; this encodes the identical
// ordering so red→green assertions are exact.

import { MeetingErrorCode } from '../service/errors';

/** All facts the oracle needs. Booleans reflect server-authoritative state. */
export interface AdmissionFacts {
  /** S-1: caller is same-Space active member OR creator OR invitee OR participant. */
  callerAuthorizedToKnowExistence: boolean;
  exists: boolean;
  ended: boolean;
  cancelled: boolean;
  locked: boolean;
  full: boolean;
  removedForCaller: boolean;
  tooEarly: boolean;
  /** Caller's current Space equals the meeting's Space. */
  sameSpace: boolean;
  // password inputs (only consulted once eligible)
  passwordEnabled: boolean;
  hasValidPassToken: boolean;
  creatorExempt: boolean; // creator joining own meeting (FD-26)
  reconnectGraceExempt: boolean; // same-endpoint 15s grace (FD-29)
}

export interface AdmissionVerdict {
  eligible: boolean;
  /** Present only when NOT eligible — the first failing step-1 code. */
  code?: MeetingErrorCode;
  /** Only meaningful when eligible. */
  passwordRequired?: boolean;
  allowedToPrejoin?: boolean;
}

/**
 * N1 truth table: password_required is true iff the meeting enables a password
 * AND the caller has no TTL-valid pass token AND is not covered by the creator
 * or same-endpoint-15s-grace exemptions.
 */
export function computePasswordRequired(facts: AdmissionFacts): boolean {
  return (
    facts.passwordEnabled && !facts.hasValidPassToken && !facts.creatorExempt && !facts.reconnectGraceExempt
  );
}

/**
 * The step-1 ordering (FD-27), applied AFTER the S-1 authorization envelope:
 *   authorized-to-know → exists → not-ended → not-cancelled → not-locked →
 *   not-full → not-removed → not-too-early → same-Space.
 *
 * On multiple failures the FIRST failing code wins ("locked + full + removed" →
 * LOCKED; "removed + cross-Space" → REMOVED). An unauthorized caller collapses
 * to CREDENTIAL_INVALID (404) for ANY real state and never sees NOT_SAME_SPACE,
 * a step-1 code, or password state — indistinguishable from "does not exist".
 */
export function evaluateAdmission(facts: AdmissionFacts): AdmissionVerdict {
  // S-1 envelope — decided before any state is revealed.
  if (!facts.callerAuthorizedToKnowExistence) {
    return { eligible: false, code: MeetingErrorCode.CREDENTIAL_INVALID };
  }
  if (!facts.exists) return { eligible: false, code: MeetingErrorCode.CREDENTIAL_INVALID };
  if (facts.ended) return { eligible: false, code: MeetingErrorCode.ENDED };
  if (facts.cancelled) return { eligible: false, code: MeetingErrorCode.CANCELLED };
  if (facts.locked) return { eligible: false, code: MeetingErrorCode.LOCKED };
  if (facts.full) return { eligible: false, code: MeetingErrorCode.FULL };
  if (facts.removedForCaller) return { eligible: false, code: MeetingErrorCode.REMOVED };
  if (facts.tooEarly) return { eligible: false, code: MeetingErrorCode.TOO_EARLY };
  if (!facts.sameSpace) return { eligible: false, code: MeetingErrorCode.NOT_SAME_SPACE };

  const passwordRequired = computePasswordRequired(facts);
  return { eligible: true, passwordRequired, allowedToPrejoin: !passwordRequired };
}

/**
 * Host-transfer target ordering (N2, FD-06). Server-authoritative; the frontend
 * only renders the server's chosen host. This comparator encodes the identical
 * rule (earliest active segment.joinAt asc, uid asc to break ties) purely for
 * deterministic E2E/unit assertions of visibility order.
 */
export interface TransferCandidate {
  uid: string;
  joinAt: string; // UTC ISO-8601
  superseded: boolean;
  left: boolean;
}

export function pickHostTransferTarget(candidates: TransferCandidate[]): string | undefined {
  const active = candidates.filter((c) => !c.superseded && !c.left);
  if (active.length === 0) return undefined;
  active.sort((a, b) => {
    if (a.joinAt !== b.joinAt) return a.joinAt < b.joinAt ? -1 : 1;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
  return active[0].uid;
}
