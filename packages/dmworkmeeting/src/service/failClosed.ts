// Fail-closed classification (§6.2). Any identity / Space / service uncertainty
// refuses entry to Meeting business — never degrades to a default uid/org and
// never leaks password-protection state.

import type { WireError } from './contracts';
import { MeetingErrorCode, isMeetingErrorCode } from './errors';

export interface HttpLikeError {
  response?: { status?: number; data?: WireError | unknown };
  message?: string;
}

export interface CanonicalError {
  /** Canonical MEETING_* code, when the service returned a structured error. */
  code?: MeetingErrorCode;
  httpStatus?: number;
  wire?: WireError;
}

export type FailClosedKind =
  | 'auth' // missing/expired token or 401 → logout, no business entry
  | 'space' // Space verify failure → switch space / no content, no password state
  | 'service-unavailable' // 503 / readiness / livekit unavailable → ServiceUnavailable, retry by retry_after
  | 'gateway-missing' // 404 without canonical code → feature not enabled / hide tab
  | 'canonical' // structured MEETING_* error → hand to the error table
  | 'unknown';

export interface FailClosedDecision {
  kind: FailClosedKind;
  code?: MeetingErrorCode;
  /** For service-unavailable, seconds to wait before retry (from retry_after). */
  retryAfter?: number;
}

export function extractCanonicalError(err: unknown): CanonicalError {
  const e = err as HttpLikeError;
  const status = e?.response?.status;
  const data = e?.response?.data as WireError | undefined;
  const rawCode = data && typeof data === 'object' ? (data as WireError).code : undefined;
  return {
    code: isMeetingErrorCode(rawCode) ? rawCode : undefined,
    httpStatus: status,
    wire: data && typeof data === 'object' ? (data as WireError) : undefined,
  };
}

/**
 * Classify a request failure into a fail-closed decision.
 *
 * Ordering matters: a 404 that carries a canonical MEETING_CREDENTIAL_INVALID is
 * a real "invalid credential" (S-1 oracle) and must NOT be confused with a
 * gateway route that is simply not mounted (404 without any `code`).
 */
export function classifyFailure(err: unknown): FailClosedDecision {
  const { code, httpStatus, wire } = extractCanonicalError(err);

  // Structured canonical error → route through the error table.
  if (code) {
    if (code === MeetingErrorCode.AUTH_REQUIRED) return { kind: 'auth', code };
    if (code === MeetingErrorCode.NOT_SAME_SPACE) return { kind: 'space', code };
    if (code === MeetingErrorCode.LIVEKIT_UNAVAILABLE) {
      return { kind: 'service-unavailable', code, retryAfter: wire?.retry_after };
    }
    return { kind: 'canonical', code };
  }

  if (httpStatus === 401) return { kind: 'auth' };
  if (httpStatus === 403) return { kind: 'space' };
  if (httpStatus === 503) return { kind: 'service-unavailable', retryAfter: wire?.retry_after };
  // 404 with no canonical code → gateway route missing / feature not enabled.
  if (httpStatus === 404) return { kind: 'gateway-missing' };

  return { kind: 'unknown' };
}

/** True when there is no usable token — refuse business entry before any request. */
export function hasNoToken(token: string | undefined | null): boolean {
  return !token;
}
