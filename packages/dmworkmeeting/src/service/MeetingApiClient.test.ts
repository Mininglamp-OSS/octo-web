import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import { MeetingApiClient, resolveMeetingBaseURL, newIdempotencyKey } from './MeetingApiClient';
// Resolved to src/__mocks__/dmworkBase.ts by vitest.config.ts alias; imported
// directly here so the mock-only test helpers typecheck too (same module
// instance at runtime under the alias).
import { WKApp, __resetWKApp, __logoutCalls } from '../__mocks__/dmworkBase';

// Capture the final request config (post-interceptor) via a fake adapter.
let lastConfig: Record<string, unknown> | null = null;
function installFakeAdapter(behaviour: (config: Record<string, unknown>) => AxiosResponse | Promise<never>) {
  MeetingApiClient.raw.defaults.adapter = ((config: Record<string, unknown>) => {
    lastConfig = config;
    const res = behaviour(config);
    return res instanceof Promise ? res : Promise.resolve(res);
  }) as never;
}
const ok = (data: unknown, config: Record<string, unknown>): AxiosResponse =>
  ({ data, status: 200, statusText: 'OK', headers: {}, config } as never);

beforeEach(() => {
  __resetWKApp();
  lastConfig = null;
});

describe('resolveMeetingBaseURL — origin derivation (mirrors summaryApi.ts:49-56)', () => {
  it('relative Web apiURL → empty baseURL (same origin)', () => {
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
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('request interceptor — identity headers (§6.1)', () => {
  it('injects token, X-Space-Id, Accept-Language and prefixes /meeting/api/v1', async () => {
    installFakeAdapter((config) => ok({ eligible: true, meeting_id: 'm1' }, config));
    WKApp.loginInfo.token = 'tkn-1';
    WKApp.shared.currentSpaceId = 'space-xyz';

    await MeetingApiClient.evaluate({ source: 'number', meetingNumber: '123' });

    const headers = (lastConfig as { headers: Record<string, string> }).headers;
    const url = (lastConfig as { url: string }).url;
    expect(headers['token']).toBe('tkn-1');
    expect(headers['X-Space-Id']).toBe('space-xyz');
    expect(headers['Accept-Language']).toBeTruthy();
    // NEVER trust/send browser identity as authority.
    expect(headers['x-user-id']).toBeUndefined();
    expect(headers['x-org-id']).toBeUndefined();
    expect(url).toBe('/meeting/api/v1/v1/meetings/admission/evaluate');
  });

  it('omits token header when unauthenticated', async () => {
    installFakeAdapter((config) => ok({}, config));
    WKApp.loginInfo.token = undefined;
    await MeetingApiClient.listMeetings('upcoming');
    const headers = (lastConfig as { headers: Record<string, string> }).headers;
    expect(headers['token']).toBeUndefined();
  });

  it('If-Match and Idempotency-Key are sent on writes', async () => {
    installFakeAdapter((config) => ok({ meeting_id: 'm2' }, config));
    const key = newIdempotencyKey();
    await MeetingApiClient.quickCreate({ title: 'q' }, { idempotencyKey: key, ifMatch: 4 });
    const headers = (lastConfig as { headers: Record<string, string> }).headers;
    expect(headers['Idempotency-Key']).toBe(key);
    expect(headers['If-Match']).toBe('4');
  });
});

describe('response interceptor — 401 → logout (mirrors summaryApi.ts:78-79)', () => {
  it('a 401 triggers WKApp.shared.logout()', async () => {
    installFakeAdapter(() => Promise.reject({ response: { status: 401 } }) as Promise<never>);
    await expect(MeetingApiClient.getMeeting('m1')).rejects.toBeTruthy();
    expect(__logoutCalls.count).toBe(1);
  });

  it('a non-401 does NOT logout', async () => {
    installFakeAdapter(() => Promise.reject({ response: { status: 423, data: { code: 'MEETING_LOCKED' } } }) as Promise<never>);
    await expect(MeetingApiClient.getMeeting('m1')).rejects.toBeTruthy();
    expect(__logoutCalls.count).toBe(0);
  });
});
