import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeetingApiClient, resolveMeetingBaseURL, newIdempotencyKey, MeetingHttpError } from './MeetingApiClient';
// Resolved to src/__mocks__/dmworkBase.ts by vitest.config.ts alias; imported
// directly here so the mock-only test helpers typecheck too (same module
// instance at runtime under the alias).
import { WKApp, __resetWKApp, __logoutCalls } from '../__mocks__/dmworkBase';

interface FetchCall {
  url: string;
  init: RequestInit;
}
let calls: FetchCall[] = [];

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const headersOf = (i: number) => (calls[i].init.headers as Record<string, string>) ?? {};

beforeEach(() => {
  __resetWKApp();
  calls = [];
});
afterEach(() => vi.restoreAllMocks());

describe('resolveMeetingBaseURL — origin derivation (mirrors summaryApi.ts:49-56)', () => {
  it('relative Web apiURL → empty base (same origin)', () => {
    expect(resolveMeetingBaseURL('/api/v1/')).toBe('');
  });
  it('absolute Electron/extension apiURL → its origin', () => {
    expect(resolveMeetingBaseURL('https://octo.example.com/api/v1/')).toBe('https://octo.example.com');
  });
  it('empty/undefined → same origin', () => {
    expect(resolveMeetingBaseURL(undefined)).toBe('');
    expect(resolveMeetingBaseURL('')).toBe('');
  });
});

describe('idempotency key', () => {
  it('generates non-empty unique keys', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('request headers (§6.1)', () => {
  it('injects token, X-Space-Id, Accept-Language and prefixes /meeting/api/v1; no browser identity', async () => {
    stubFetch(200, { eligible: true, meeting_id: 'm1' });
    WKApp.loginInfo.token = 'tkn-1';
    WKApp.shared.currentSpaceId = 'space-xyz';
    await MeetingApiClient.evaluate({ source: 'number', meetingNumber: '123' });
    const h = headersOf(0);
    expect(h['token']).toBe('tkn-1');
    expect(h['X-Space-Id']).toBe('space-xyz');
    expect(h['Accept-Language']).toBeTruthy();
    expect(h['x-user-id']).toBeUndefined();
    expect(h['x-org-id']).toBeUndefined();
    expect(calls[0].url).toBe('/meeting/api/v1/v1/meetings/admission/evaluate');
  });

  it('omits token header when unauthenticated', async () => {
    stubFetch(200, {});
    WKApp.loginInfo.token = undefined;
    await MeetingApiClient.listMeetings('upcoming');
    expect(headersOf(0)['token']).toBeUndefined();
    expect(calls[0].url).toContain('view=upcoming');
  });

  it('If-Match and Idempotency-Key are sent on writes', async () => {
    stubFetch(200, { meeting_id: 'm2' });
    const key = newIdempotencyKey();
    await MeetingApiClient.quickCreate({ title: 'q' }, { idempotencyKey: key, ifMatch: 4 });
    const h = headersOf(0);
    expect(h['Idempotency-Key']).toBe(key);
    expect(h['If-Match']).toBe('4');
  });
});

describe('401 → logout only for authentication failures (#1 regression)', () => {
  it('a bare 401 (no code) logs out', async () => {
    stubFetch(401, undefined);
    await expect(MeetingApiClient.getMeeting('m1')).rejects.toBeInstanceOf(MeetingHttpError);
    expect(__logoutCalls.count).toBe(1);
  });

  it('MEETING_AUTH_REQUIRED (401) logs out', async () => {
    stubFetch(401, { code: 'MEETING_AUTH_REQUIRED' });
    await expect(MeetingApiClient.getMeeting('m1')).rejects.toBeTruthy();
    expect(__logoutCalls.count).toBe(1);
  });

  it('MEETING_PASSWORD_INVALID (401) does NOT log out', async () => {
    stubFetch(401, { code: 'MEETING_PASSWORD_INVALID', attempts_remaining: 3 });
    await expect(
      MeetingApiClient.verifyPassword({ meetingId: 'm', passwordChallengeId: 'c', password: '000000' }),
    ).rejects.toBeInstanceOf(MeetingHttpError);
    expect(__logoutCalls.count).toBe(0);
  });

  it('MEETING_PASSWORD_PASS_EXPIRED (401) does NOT log out', async () => {
    stubFetch(401, { code: 'MEETING_PASSWORD_PASS_EXPIRED' });
    await expect(
      MeetingApiClient.finalize({ meetingId: 'm', source: 'link', deviceIdHash: 'd' }),
    ).rejects.toBeTruthy();
    expect(__logoutCalls.count).toBe(0);
  });

  it('a non-401 error never logs out', async () => {
    stubFetch(423, { code: 'MEETING_LOCKED' });
    await expect(MeetingApiClient.getMeeting('m1')).rejects.toBeInstanceOf(MeetingHttpError);
    expect(__logoutCalls.count).toBe(0);
  });
});

describe('error shape', () => {
  it('non-2xx throws MeetingHttpError carrying response.status/data', async () => {
    stubFetch(409, { code: 'MEETING_VERSION_CONFLICT' });
    try {
      await MeetingApiClient.cancelMeeting('m', { ifMatch: 1 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MeetingHttpError);
      expect((err as MeetingHttpError).response.status).toBe(409);
      expect((err as MeetingHttpError).response.data?.code).toBe('MEETING_VERSION_CONFLICT');
    }
  });
});
