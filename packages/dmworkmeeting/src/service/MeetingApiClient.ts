// The single Meeting HTTP client + adapter seam. Faithfully mirrors the Smart
// Summary client boundary (packages/dmworksummary/src/api/summaryApi.ts:41-79)
// as the approved reference: derive origin from apiClient.config.apiURL for
// non-Web runtimes, inject token / X-Space-Id / Accept-Language, and logout on
// 401. It NEVER sends or trusts x-user-id / x-org-id as identity authority
// (§6.1) — the gateway/service token verify is the only identity source.

import axios, { AxiosRequestConfig } from 'axios';
import { WKApp, buildAcceptLanguage } from '@octo/base';
import { MEETING_API_BASE, MeetingEndpoint } from './contracts';
import type {
  AdmissionEvaluateRequest,
  AdmissionEvaluateResult,
  AdmissionFinalizeRequest,
  AdmissionFinalizeResult,
  Meeting,
  MeetingListResult,
  PasswordVerifyRequest,
  PasswordVerifyResult,
  QuickCreateRequest,
  ScheduleCreateRequest,
} from './contracts';
import {
  decodeEvaluate,
  decodeFinalize,
  decodeList,
  decodeMeeting,
  decodePasswordVerify,
  encodeEvaluate,
  encodeFinalize,
  encodePasswordVerify,
  toSnakeDeep,
} from './adapter';

const meetingAxios = axios.create({ baseURL: '' });

/**
 * Web keeps a relative apiURL ("/api/v1/") → same-origin, empty baseURL. In
 * Electron / extension the page origin is app:// or chrome-extension://, so a
 * relative "/meeting/api/v1/…" never reaches the backend; derive the API origin
 * from apiClient.config.apiURL. Pure so it is unit-testable. Mirrors
 * summaryApi.ts:49-56.
 */
export function resolveMeetingBaseURL(apiURL: string | undefined | null): string {
  if (!apiURL) return '';
  try {
    return new URL(apiURL).origin;
  } catch {
    return ''; // relative apiURL (Web) has no parsable origin → stay same-origin
  }
}

meetingAxios.interceptors.request.use((config) => {
  config.baseURL = resolveMeetingBaseURL(WKApp.apiClient?.config?.apiURL);
  config.headers = config.headers ?? {};
  config.headers['Accept-Language'] = buildAcceptLanguage();
  const token = WKApp.loginInfo?.token;
  if (token) config.headers['token'] = token;
  const spaceId = WKApp.shared?.currentSpaceId;
  if (spaceId) config.headers['X-Space-Id'] = spaceId;
  // NOTE: deliberately no x-user-id / x-org-id — identity is server-authoritative.
  return config;
});

meetingAxios.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401) {
      WKApp.shared?.logout?.();
    }
    return Promise.reject(err);
  },
);

/** Generate an explicit Idempotency-Key. quick-create reuses ONE key across all
 * retries so a duplicate click within/across the 2s bucket returns the first
 * result; the explicit key takes precedence over the implicit bucket (N3). */
export function newIdempotencyKey(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Deterministic-ish fallback (no Math.random dependency requirement here, but
  // avoid collisions across a session).
  return `idem-${Date.now().toString(36)}-${(idemCounter++).toString(36)}`;
}
let idemCounter = 0;

interface WriteOpts {
  /** Optimistic-concurrency version → If-Match header. */
  ifMatch?: number;
  /** Explicit idempotency key (quick-create reuses one across retries). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function writeHeaders(opts?: WriteOpts): Record<string, string> {
  const h: Record<string, string> = {};
  if (opts?.ifMatch !== undefined) h['If-Match'] = String(opts.ifMatch);
  if (opts?.idempotencyKey) h['Idempotency-Key'] = opts.idempotencyKey;
  return h;
}

// Backend may wrap responses in {code,message,data}; unwrap .data when present.
function unwrap(data: unknown): unknown {
  if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>).data;
  }
  return data;
}

async function get<T>(path: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
  const resp = await meetingAxios.get(`${MEETING_API_BASE}${path}`, { params, ...config });
  return unwrap(resp.data) as T;
}
async function post<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const resp = await meetingAxios.post(`${MEETING_API_BASE}${path}`, body, config);
  return unwrap(resp.data) as T;
}
async function patch<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const resp = await meetingAxios.patch(`${MEETING_API_BASE}${path}`, body, config);
  return unwrap(resp.data) as T;
}
async function del<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
  const resp = await meetingAxios.delete(`${MEETING_API_BASE}${path}`, config);
  return unwrap(resp.data) as T;
}
async function put<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const resp = await meetingAxios.put(`${MEETING_API_BASE}${path}`, body, config);
  return unwrap(resp.data) as T;
}

export const MeetingApiClient = {
  raw: meetingAxios,

  async listMeetings(
    view: 'upcoming' | 'history',
    opts?: { pageSize?: number; pageToken?: string; signal?: AbortSignal },
  ): Promise<MeetingListResult> {
    const data = await get<unknown>(
      MeetingEndpoint.list,
      { view, page_size: opts?.pageSize, page_token: opts?.pageToken },
      { signal: opts?.signal },
    );
    return decodeList(data as never);
  },

  async getMeeting(id: string, signal?: AbortSignal): Promise<Meeting> {
    return decodeMeeting((await get<unknown>(MeetingEndpoint.get(id), undefined, { signal })) as never);
  },

  async quickCreate(req: QuickCreateRequest, opts: WriteOpts): Promise<Meeting> {
    const data = await post<unknown>(MeetingEndpoint.quickCreate, toSnakeDeep(req), {
      headers: writeHeaders(opts),
      signal: opts.signal,
    });
    return decodeMeeting(data as never);
  },

  async scheduleCreate(req: ScheduleCreateRequest, opts?: WriteOpts): Promise<Meeting> {
    const data = await post<unknown>(MeetingEndpoint.create, toSnakeDeep(req), {
      headers: writeHeaders(opts),
      signal: opts?.signal,
    });
    return decodeMeeting(data as never);
  },

  async patchMeeting(id: string, patchBody: Partial<ScheduleCreateRequest>, opts: WriteOpts): Promise<Meeting> {
    const data = await patch<unknown>(MeetingEndpoint.patch(id), toSnakeDeep(patchBody), {
      headers: writeHeaders(opts),
      signal: opts.signal,
    });
    return decodeMeeting(data as never);
  },

  async cancelMeeting(id: string, opts: WriteOpts): Promise<void> {
    await post<unknown>(MeetingEndpoint.cancel(id), {}, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async evaluate(req: AdmissionEvaluateRequest, signal?: AbortSignal): Promise<AdmissionEvaluateResult> {
    const data = await post<unknown>(MeetingEndpoint.evaluate, encodeEvaluate(req), { signal });
    return decodeEvaluate(data as never);
  },

  async verifyPassword(req: PasswordVerifyRequest, signal?: AbortSignal): Promise<PasswordVerifyResult> {
    const data = await post<unknown>(MeetingEndpoint.passwordVerify, encodePasswordVerify(req), { signal });
    return decodePasswordVerify(data as never);
  },

  async finalize(req: AdmissionFinalizeRequest, opts?: WriteOpts): Promise<AdmissionFinalizeResult> {
    const data = await post<unknown>(MeetingEndpoint.finalize, encodeFinalize(req), {
      headers: writeHeaders(opts),
      signal: opts?.signal,
    });
    return decodeFinalize(data as never);
  },

  async leave(id: string, opts: WriteOpts): Promise<void> {
    await post<unknown>(MeetingEndpoint.leave(id), {}, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async setRole(id: string, uid: string, role: string, opts: WriteOpts): Promise<void> {
    await put<unknown>(MeetingEndpoint.role(id, uid), { role }, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async mute(id: string, body: { target_uid?: string; all?: boolean; muted: boolean }, opts: WriteOpts): Promise<void> {
    await post<unknown>(MeetingEndpoint.mute(id), body, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async removeParticipant(id: string, uid: string, opts: WriteOpts): Promise<void> {
    await del<unknown>(MeetingEndpoint.removeParticipant(id, uid), { headers: writeHeaders(opts), signal: opts.signal });
  },

  async setLock(id: string, locked: boolean, opts: WriteOpts): Promise<void> {
    await put<unknown>(MeetingEndpoint.lock(id), { locked }, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async end(id: string, opts: WriteOpts): Promise<void> {
    await post<unknown>(MeetingEndpoint.end(id), {}, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async startShare(id: string, opts: WriteOpts): Promise<void> {
    await post<unknown>(MeetingEndpoint.share(id), {}, { headers: writeHeaders(opts), signal: opts.signal });
  },

  async stopShare(id: string, opts: WriteOpts): Promise<void> {
    await del<unknown>(MeetingEndpoint.share(id), { headers: writeHeaders(opts), signal: opts.signal });
  },
};

export type MeetingApiClientType = typeof MeetingApiClient;
