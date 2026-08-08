import { describe, it, expect } from 'vitest';
import {
  evaluateAdmission,
  computePasswordRequired,
  pickHostTransferTarget,
  type AdmissionFacts,
} from './admission';
import { MeetingErrorCode } from '../service/errors';

const base = (over: Partial<AdmissionFacts> = {}): AdmissionFacts => ({
  callerAuthorizedToKnowExistence: true,
  exists: true,
  ended: false,
  cancelled: false,
  locked: false,
  full: false,
  removedForCaller: false,
  tooEarly: false,
  sameSpace: true,
  passwordEnabled: false,
  hasValidPassToken: false,
  creatorExempt: false,
  reconnectGraceExempt: false,
  ...over,
});

describe('admission oracle — step-1 ordering (FD-27)', () => {
  it('eligible with no password → allowedToPrejoin true (N1)', () => {
    const v = evaluateAdmission(base());
    expect(v.eligible).toBe(true);
    expect(v.passwordRequired).toBe(false);
    expect(v.allowedToPrejoin).toBe(true);
  });

  it('eligible + password enabled → challenge, not prejoin (N1)', () => {
    const v = evaluateAdmission(base({ passwordEnabled: true }));
    expect(v.eligible).toBe(true);
    expect(v.passwordRequired).toBe(true);
    expect(v.allowedToPrejoin).toBe(false);
  });

  it.each([
    ['ended', { ended: true }, MeetingErrorCode.ENDED],
    ['cancelled', { cancelled: true }, MeetingErrorCode.CANCELLED],
    ['locked', { locked: true }, MeetingErrorCode.LOCKED],
    ['full', { full: true }, MeetingErrorCode.FULL],
    ['removed', { removedForCaller: true }, MeetingErrorCode.REMOVED],
    ['too early', { tooEarly: true }, MeetingErrorCode.TOO_EARLY],
    ['cross-space (authorized)', { sameSpace: false }, MeetingErrorCode.NOT_SAME_SPACE],
  ] as const)('%s → %s', (_label, over, code) => {
    const v = evaluateAdmission(base(over));
    expect(v.eligible).toBe(false);
    expect(v.code).toBe(code);
    // Never leak password state on an ineligible verdict.
    expect(v.passwordRequired).toBeUndefined();
    expect(v.allowedToPrejoin).toBeUndefined();
  });

  it('multi-failure takes the FIRST code: locked + full + removed → LOCKED', () => {
    expect(evaluateAdmission(base({ locked: true, full: true, removedForCaller: true })).code).toBe(
      MeetingErrorCode.LOCKED,
    );
  });

  it('multi-failure: removed + cross-Space → REMOVED (removed precedes space)', () => {
    expect(evaluateAdmission(base({ removedForCaller: true, sameSpace: false })).code).toBe(
      MeetingErrorCode.REMOVED,
    );
  });
});

describe('admission oracle — S-1 enumeration envelope', () => {
  it('unauthorized caller always gets CREDENTIAL_INVALID, regardless of real state', () => {
    // A live, locked, cross-space meeting that really exists — unauthorized
    // caller must not learn any of that.
    const v = evaluateAdmission(
      base({ callerAuthorizedToKnowExistence: false, locked: true, sameSpace: false, passwordEnabled: true }),
    );
    expect(v.code).toBe(MeetingErrorCode.CREDENTIAL_INVALID);
    expect(v.code).not.toBe(MeetingErrorCode.NOT_SAME_SPACE);
    expect(v.code).not.toBe(MeetingErrorCode.LOCKED);
  });

  it('non-existent meeting is indistinguishable from unauthorized guess', () => {
    const missing = evaluateAdmission(base({ exists: false }));
    const unauthorized = evaluateAdmission(base({ callerAuthorizedToKnowExistence: false }));
    expect(missing.code).toBe(MeetingErrorCode.CREDENTIAL_INVALID);
    expect(unauthorized.code).toBe(MeetingErrorCode.CREDENTIAL_INVALID);
  });

  it('authorized cross-Space caller (creator/invitee/participant) gets NOT_SAME_SPACE, not 404', () => {
    const v = evaluateAdmission(base({ callerAuthorizedToKnowExistence: true, sameSpace: false }));
    expect(v.code).toBe(MeetingErrorCode.NOT_SAME_SPACE);
  });
});

describe('password_required truth table (N1)', () => {
  it('creator exemption suppresses password', () => {
    expect(computePasswordRequired(base({ passwordEnabled: true, creatorExempt: true }))).toBe(false);
  });
  it('valid pass token suppresses password', () => {
    expect(computePasswordRequired(base({ passwordEnabled: true, hasValidPassToken: true }))).toBe(false);
  });
  it('same-endpoint 15s grace suppresses password', () => {
    expect(computePasswordRequired(base({ passwordEnabled: true, reconnectGraceExempt: true }))).toBe(false);
  });
  it('enabled with no exemption requires password', () => {
    expect(computePasswordRequired(base({ passwordEnabled: true }))).toBe(true);
  });
});

describe('host-transfer target ordering (N2, FD-06)', () => {
  it('earliest joinAt wins, uid breaks ties, superseded/left excluded', () => {
    const target = pickHostTransferTarget([
      { uid: 'zeta', joinAt: '2026-01-01T00:00:01Z', superseded: false, left: false },
      { uid: 'alpha', joinAt: '2026-01-01T00:00:01Z', superseded: false, left: false }, // tie → uid asc
      { uid: 'early', joinAt: '2026-01-01T00:00:00Z', superseded: true, left: false }, // excluded
      { uid: 'gone', joinAt: '2026-01-01T00:00:00Z', superseded: false, left: true }, // excluded
    ]);
    expect(target).toBe('alpha');
  });
  it('no active candidate → undefined', () => {
    expect(pickHostTransferTarget([{ uid: 'x', joinAt: 't', superseded: true, left: false }])).toBeUndefined();
  });
});
