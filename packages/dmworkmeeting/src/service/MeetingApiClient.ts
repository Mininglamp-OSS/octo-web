// The single Meeting HTTP client + adapter seam. Faithfully mirrors the Smart
// Summary client boundary (packages/dmworksummary/src/api/summaryApi.ts) as the
// approved reference: derive origin from apiClient.config.apiURL for non-Web
// runtimes, inject token / X-Space-Id / Accept-Language, and logout on an
// *authentication* 401. It NEVER sends or trusts x-user-id / x-org-id as
// identity authority (§6.1) — the gateway/service token verify is the only
// identity source.
//
// Implemented over fetch (NOT axios): the meeting package must not introduce a
// vulnerable axios@0.25.x dependency edge into the dependency-review gate, and
// the repo convention discourages new per-package axios instances. fetch gives
// the same header/origin/401 semantics with zero new runtime dependency.

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
  WireError,
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
import { MeetingErrorCode, isMeetingErrorCode } from './errors';

/** Error thrown for a non-2xx response. Shaped so classifyFailure /
 * extractCanonicalError read `.response.status` / `.response.data` unchanged. */
export class MeetingHttpError extends Error {
  response: { status: number; data?: WireError };
  constructor(status: number, data?: WireError) {
    super(data?.code ?? `HTTP ${status}`);
    this.name = 'MeetingHttpError';
    this.response = { status, data };
  }
}

/**
 * Web keeps a relative apiURL ("/api/v1/") → same-origin (empty base). In
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

/** Generate an explicit Idempotency-Key. Callers reuse ONE key across retries so
 * a duplicate request within/across the 2s bucket returns the first result; the
 * explicit key takes precedence over the implicit bucket (N3). */
export function newIdempotencyKey(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${(idemCounter++).toString(36)}`;
}
let idemCounter = 0;

interface WriteOpts {
  ifMatch?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.append(k, String(v));
  }
  const q = usp.toString();
  return q ? `?${q}` : '';
}

async function request<T>(
  method: Method,
  path: string,
  opts: { body?: unknown; params?: Record<string, unknown>; write?: WriteOpts; signal?: AbortSignal } = {},
): Promise<T> {
  const base = resolveMeetingBaseURL(WKApp.apiClient?.config?.apiURL);
  const url = `${base}${MEETING_API_BASE}${path}${buildQuery(opts.params)}`;

  const headers: Record<string, string> = { 'Accept-Language': buildAcceptLanguage() };
  const token = WKApp.loginInfo?.token;
  if (token) headers['token'] = token;
  const spaceId = WKApp.shared?.currentSpaceId;
  if (spaceId) headers['X-Space-Id'] = spaceId;
  // NOTE: deliberately no x-user-id / x-org-id — identity is server-authoritative.
  if (opts.write?.ifMatch !== undefined) headers['If-Match'] = String(opts.write.ifMatch);
  if (opts.write?.idempotencyKey) headers['Idempotency-Key'] = opts.write.idempotencyKey;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const resp = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal ?? opts.write?.signal,
  });

  const raw = await resp.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!resp.ok) {
    const data = (parsed && typeof parsed === 'object' ? (parsed as WireError) : undefined) as WireError | undefined;
    // Only an AUTHENTICATION 401 logs out. Business 401 codes such as
    // MEETING_PASSWORD_INVALID / MEETING_PASSWORD_PASS_EXPIRED must NOT tear
    // down the IM session (regression fix).
    if (resp.status === 401) {
      const code = data?.code;
      const isAuthFailure = !code || code === MeetingErrorCode.AUTH_REQUIRED || !isMeetingErrorCode(code);
      if (isAuthFailure) WKApp.shared?.logout?.();
    }
    throw new MeetingHttpError(resp.status, data);
  }

  // Backend may wrap responses in {code,message,data}; unwrap .data when present.
  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
    return (parsed as Record<string, unknown>).data as T;
  }
  return parsed as T;
}

export const MeetingApiClient = {
  async listMeetings(
    view: 'upcoming' | 'history',
    opts?: { pageSize?: number; pageToken?: string; signal?: AbortSignal },
  ): Promise<MeetingListResult> {
    const data = await request<unknown>('GET', MeetingEndpoint.list, {
      params: { view, page_size: opts?.pageSize, page_token: opts?.pageToken },
      signal: opts?.signal,
    });
    return decodeList(data as never);
  },

  async getMeeting(id: string, signal?: AbortSignal): Promise<Meeting> {
    return decodeMeeting((await request<unknown>('GET', MeetingEndpoint.get(id), { signal })) as never);
  },

  async quickCreate(req: QuickCreateRequest, opts: WriteOpts): Promise<Meeting> {
    const data = await request<unknown>('POST', MeetingEndpoint.quickCreate, { body: toSnakeDeep(req), write: opts });
    return decodeMeeting(data as never);
  },

  async scheduleCreate(req: ScheduleCreateRequest, opts?: WriteOpts): Promise<Meeting> {
    const data = await request<unknown>('POST', MeetingEndpoint.create, { body: toSnakeDeep(req), write: opts });
    return decodeMeeting(data as never);
  },

  async patchMeeting(id: string, patchBody: Partial<ScheduleCreateRequest>, opts: WriteOpts): Promise<Meeting> {
    const data = await request<unknown>('PATCH', MeetingEndpoint.patch(id), { body: toSnakeDeep(patchBody), write: opts });
    return decodeMeeting(data as never);
  },

  async cancelMeeting(id: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('POST', MeetingEndpoint.cancel(id), { body: {}, write: opts });
  },

  async evaluate(req: AdmissionEvaluateRequest, signal?: AbortSignal): Promise<AdmissionEvaluateResult> {
    const data = await request<unknown>('POST', MeetingEndpoint.evaluate, { body: encodeEvaluate(req), write: { signal } });
    return decodeEvaluate(data as never);
  },

  async verifyPassword(req: PasswordVerifyRequest, signal?: AbortSignal): Promise<PasswordVerifyResult> {
    const data = await request<unknown>('POST', MeetingEndpoint.passwordVerify, { body: encodePasswordVerify(req), write: { signal } });
    return decodePasswordVerify(data as never);
  },

  async finalize(req: AdmissionFinalizeRequest, opts?: WriteOpts): Promise<AdmissionFinalizeResult> {
    const data = await request<unknown>('POST', MeetingEndpoint.finalize, { body: encodeFinalize(req), write: opts });
    return decodeFinalize(data as never);
  },

  async leave(id: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('POST', MeetingEndpoint.leave(id), { body: {}, write: opts });
  },

  async setRole(id: string, uid: string, role: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('PUT', MeetingEndpoint.role(id, uid), { body: { role }, write: opts });
  },

  async mute(id: string, body: { target_uid?: string; all?: boolean; muted: boolean }, opts: WriteOpts): Promise<void> {
    await request<unknown>('POST', MeetingEndpoint.mute(id), { body, write: opts });
  },

  async removeParticipant(id: string, uid: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('DELETE', MeetingEndpoint.removeParticipant(id, uid), { write: opts });
  },

  async setLock(id: string, locked: boolean, opts: WriteOpts): Promise<void> {
    await request<unknown>('PUT', MeetingEndpoint.lock(id), { body: { locked }, write: opts });
  },

  async end(id: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('POST', MeetingEndpoint.end(id), { body: {}, write: opts });
  },

  async startShare(id: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('POST', MeetingEndpoint.share(id), { body: {}, write: opts });
  },

  async stopShare(id: string, opts: WriteOpts): Promise<void> {
    await request<unknown>('DELETE', MeetingEndpoint.share(id), { write: opts });
  },
};

export type MeetingApiClientType = typeof MeetingApiClient;
