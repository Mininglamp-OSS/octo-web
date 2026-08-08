import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  extractCanonicalError,
  hasNoToken,
} from './failClosed';
import { MeetingErrorCode } from './errors';

const axiosErr = (status: number, data?: unknown) => ({ isAxiosError: true, response: { status, data } });

describe('canonical error extraction', () => {
  it('extracts a known MEETING_* code', () => {
    const c = extractCanonicalError(axiosErr(423, { code: 'MEETING_LOCKED' }));
    expect(c.code).toBe(MeetingErrorCode.LOCKED);
    expect(c.httpStatus).toBe(423);
  });
  it('ignores an unknown code', () => {
    expect(extractCanonicalError(axiosErr(404, { code: 'SOMETHING_ELSE' })).code).toBeUndefined();
  });
});

describe('fail-closed classification (§6.2)', () => {
  it('401 → auth (logout)', () => {
    expect(classifyFailure(axiosErr(401)).kind).toBe('auth');
    expect(classifyFailure(axiosErr(401, { code: 'MEETING_AUTH_REQUIRED' })).kind).toBe('auth');
  });

  it('canonical CREDENTIAL_INVALID (404 WITH code) → canonical, NOT gateway-missing (S-1)', () => {
    const d = classifyFailure(axiosErr(404, { code: 'MEETING_CREDENTIAL_INVALID' }));
    expect(d.kind).toBe('canonical');
    expect(d.code).toBe(MeetingErrorCode.CREDENTIAL_INVALID);
  });

  it('404 WITHOUT code → gateway-missing (feature not enabled)', () => {
    expect(classifyFailure(axiosErr(404, { message: 'not found' })).kind).toBe('gateway-missing');
    expect(classifyFailure(axiosErr(404)).kind).toBe('gateway-missing');
  });

  it('NOT_SAME_SPACE → space', () => {
    expect(classifyFailure(axiosErr(403, { code: 'MEETING_NOT_SAME_SPACE' })).kind).toBe('space');
  });

  it('LIVEKIT_UNAVAILABLE → service-unavailable with retry_after', () => {
    const d = classifyFailure(axiosErr(503, { code: 'MEETING_LIVEKIT_UNAVAILABLE', retry_after: 7 }));
    expect(d.kind).toBe('service-unavailable');
    expect(d.retryAfter).toBe(7);
  });

  it('bare 503 → service-unavailable', () => {
    expect(classifyFailure(axiosErr(503)).kind).toBe('service-unavailable');
  });

  it('missing token is detected before any request', () => {
    expect(hasNoToken(undefined)).toBe(true);
    expect(hasNoToken('')).toBe(true);
    expect(hasNoToken('tok')).toBe(false);
  });
});
