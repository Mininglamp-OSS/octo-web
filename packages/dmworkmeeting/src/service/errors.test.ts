import { describe, it, expect } from 'vitest';
import {
  MEETING_ERROR_TABLE,
  MeetingErrorCode,
  directiveForCode,
  isMeetingErrorCode,
} from './errors';

describe('error taxonomy (§6.4)', () => {
  it('has exactly 24 codes and no generic final-recheck code (FD-32)', () => {
    const codes = Object.keys(MEETING_ERROR_TABLE);
    expect(codes).toHaveLength(24);
    expect(codes).not.toContain('MEETING_FINAL_RECHECK_FAILED');
  });

  it('every code maps to a directive with the documented HTTP status', () => {
    const expectedStatus: Record<MeetingErrorCode, number> = {
      MEETING_AUTH_REQUIRED: 401,
      MEETING_CREDENTIAL_INVALID: 404,
      MEETING_ENDED: 410,
      MEETING_CANCELLED: 410,
      MEETING_TOO_EARLY: 409,
      MEETING_LOCKED: 423,
      MEETING_FULL: 409,
      MEETING_REMOVED: 403,
      MEETING_NOT_SAME_SPACE: 403,
      MEETING_PASSWORD_REQUIRED: 428,
      MEETING_PASSWORD_FORMAT_INVALID: 422,
      MEETING_PASSWORD_INVALID: 401,
      MEETING_PASSWORD_COOLDOWN: 429,
      MEETING_PASSWORD_PASS_EXPIRED: 401,
      MEETING_PASSWORD_IMMUTABLE: 409,
      MEETING_FORBIDDEN: 403,
      MEETING_VERSION_CONFLICT: 409,
      MEETING_IDEMPOTENCY_CONFLICT: 409,
      MEETING_SHARE_CONFLICT: 409,
      MEETING_LIVEKIT_UNAVAILABLE: 503,
      MEETING_NOTIFICATION_DEFERRED: 202,
      MEETING_TIME_INVALID: 422,
      MEETING_RATE_LIMITED: 429,
      MEETING_INTERNAL: 500,
    };
    for (const [code, status] of Object.entries(expectedStatus)) {
      expect(directiveForCode(code as MeetingErrorCode).httpStatus).toBe(status);
    }
  });

  it('only PASSWORD_INVALID consumes a password attempt', () => {
    const counting = Object.values(MEETING_ERROR_TABLE).filter((d) => d.countsPasswordAttempt);
    expect(counting).toHaveLength(1);
    expect(counting[0].code).toBe(MeetingErrorCode.PASSWORD_INVALID);
  });

  it('terminal codes are ENDED / CANCELLED / REMOVED only', () => {
    const terminal = Object.values(MEETING_ERROR_TABLE).filter((d) => d.terminal).map((d) => d.code).sort();
    expect(terminal).toEqual(
      [MeetingErrorCode.ENDED, MeetingErrorCode.CANCELLED, MeetingErrorCode.REMOVED].sort(),
    );
  });

  it('key branch actions are wired correctly', () => {
    expect(directiveForCode(MeetingErrorCode.AUTH_REQUIRED).action).toBe('LOGOUT');
    expect(directiveForCode(MeetingErrorCode.CREDENTIAL_INVALID).action).toBe('SHOW_INVALID');
    expect(directiveForCode(MeetingErrorCode.LIVEKIT_UNAVAILABLE).action).toBe('RETRY_FINALIZE');
    expect(directiveForCode(MeetingErrorCode.PASSWORD_PASS_EXPIRED).action).toBe('RESTART_CHALLENGE');
    expect(directiveForCode(MeetingErrorCode.VERSION_CONFLICT).action).toBe('REFETCH_RECONCILE');
    expect(directiveForCode(MeetingErrorCode.IDEMPOTENCY_CONFLICT).action).toBe('STOP_RETRY');
  });

  it('every directive carries a meeting.error.* i18n key', () => {
    for (const d of Object.values(MEETING_ERROR_TABLE)) {
      expect(d.i18nKey.startsWith('meeting.error.')).toBe(true);
    }
  });

  it('isMeetingErrorCode narrows only known codes', () => {
    expect(isMeetingErrorCode('MEETING_LOCKED')).toBe(true);
    expect(isMeetingErrorCode('MEETING_FINAL_RECHECK_FAILED')).toBe(false);
    expect(isMeetingErrorCode(undefined)).toBe(false);
  });
});
