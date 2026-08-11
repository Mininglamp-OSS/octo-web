// Meeting error taxonomy — a verbatim mirror of the standalone octo-meeting-service
// contract (架构总纲 §7.3, frontend appendix §6.4). Codes are NEVER renamed,
// abbreviated or merged on the frontend; there is no generic final-recheck code
// (the removed MEETING_FINAL_RECHECK_FAILED is intentionally absent — FD-32).
//
// PROVENANCE / BLOCKER: the strings below are transcribed from the approved
// design (architecture SHA f0f482c0). They MUST be reconciled byte-for-byte
// against the service-owned versioned OpenAPI/error snapshot published by
// XIN-1773 before typed-contract integration is considered complete. Contract
// tests assert only against codes present in that snapshot; see contracts.ts.

export const MeetingErrorCode = {
  AUTH_REQUIRED: 'MEETING_AUTH_REQUIRED',
  CREDENTIAL_INVALID: 'MEETING_CREDENTIAL_INVALID',
  ENDED: 'MEETING_ENDED',
  CANCELLED: 'MEETING_CANCELLED',
  TOO_EARLY: 'MEETING_TOO_EARLY',
  LOCKED: 'MEETING_LOCKED',
  FULL: 'MEETING_FULL',
  REMOVED: 'MEETING_REMOVED',
  NOT_SAME_SPACE: 'MEETING_NOT_SAME_SPACE',
  PASSWORD_REQUIRED: 'MEETING_PASSWORD_REQUIRED',
  PASSWORD_FORMAT_INVALID: 'MEETING_PASSWORD_FORMAT_INVALID',
  PASSWORD_INVALID: 'MEETING_PASSWORD_INVALID',
  PASSWORD_COOLDOWN: 'MEETING_PASSWORD_COOLDOWN',
  PASSWORD_PASS_EXPIRED: 'MEETING_PASSWORD_PASS_EXPIRED',
  PASSWORD_IMMUTABLE: 'MEETING_PASSWORD_IMMUTABLE',
  FORBIDDEN: 'MEETING_FORBIDDEN',
  VERSION_CONFLICT: 'MEETING_VERSION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'MEETING_IDEMPOTENCY_CONFLICT',
  SHARE_CONFLICT: 'MEETING_SHARE_CONFLICT',
  LIVEKIT_UNAVAILABLE: 'MEETING_LIVEKIT_UNAVAILABLE',
  NOTIFICATION_DEFERRED: 'MEETING_NOTIFICATION_DEFERRED',
  TIME_INVALID: 'MEETING_TIME_INVALID',
  RATE_LIMITED: 'MEETING_RATE_LIMITED',
  INTERNAL: 'MEETING_INTERNAL',
} as const;

export type MeetingErrorCode = (typeof MeetingErrorCode)[keyof typeof MeetingErrorCode];

// Frontend directive — the single action the UI takes for a given code. Every
// component/state branch consumes this rather than switching on raw codes, so
// the code→behaviour mapping lives in exactly one place.
export type MeetingErrorAction =
  | 'LOGOUT' // fail closed → reauth
  | 'SHOW_INVALID' // credential invalid; MUST NOT reveal password entry (S-1)
  | 'TERMINAL_ENDED'
  | 'TERMINAL_CANCELLED'
  | 'TERMINAL_REMOVED'
  | 'SHOW_TOO_EARLY'
  | 'SHOW_LOCKED'
  | 'SHOW_FULL'
  | 'SWITCH_SPACE'
  | 'SHOW_PASSWORD_CHALLENGE'
  | 'FOCUS_PASSWORD_FORMAT' // does NOT consume an attempt
  | 'SHOW_PASSWORD_INVALID' // consumes an attempt; 5th → cooldown
  | 'SHOW_COOLDOWN'
  | 'RESTART_CHALLENGE'
  | 'DISABLE_PASSWORD_EDIT'
  | 'REFRESH_CAPABILITY'
  | 'REFETCH_RECONCILE'
  | 'STOP_RETRY'
  | 'SHOW_SHARE_CONFLICT'
  | 'RETRY_FINALIZE' // keep PreJoin + pass_token; do NOT return to challenge
  | 'WARN_NON_BLOCKING'
  | 'HIGHLIGHT_TIME'
  | 'RATE_LIMIT_COUNTDOWN'
  | 'GENERIC_RETRY';

export interface MeetingErrorDirective {
  code: MeetingErrorCode;
  httpStatus: number;
  action: MeetingErrorAction;
  /** i18n key under the `meeting.error.*` namespace. */
  i18nKey: string;
  /** Enters an unrecoverable terminal state. */
  terminal: boolean;
  /** The UI may retry (bounded by retry_at/retry_after). */
  retriable: boolean;
  /** A wrong-password attempt that consumes one of the 5 tries. */
  countsPasswordAttempt: boolean;
}

const D = (
  code: MeetingErrorCode,
  httpStatus: number,
  action: MeetingErrorAction,
  i18nKey: string,
  opts: Partial<Pick<MeetingErrorDirective, 'terminal' | 'retriable' | 'countsPasswordAttempt'>> = {},
): MeetingErrorDirective => ({
  code,
  httpStatus,
  action,
  i18nKey,
  terminal: opts.terminal ?? false,
  retriable: opts.retriable ?? false,
  countsPasswordAttempt: opts.countsPasswordAttempt ?? false,
});

export const MEETING_ERROR_TABLE: Record<MeetingErrorCode, MeetingErrorDirective> = {
  [MeetingErrorCode.AUTH_REQUIRED]: D(MeetingErrorCode.AUTH_REQUIRED, 401, 'LOGOUT', 'meeting.error.authRequired'),
  [MeetingErrorCode.CREDENTIAL_INVALID]: D(MeetingErrorCode.CREDENTIAL_INVALID, 404, 'SHOW_INVALID', 'meeting.error.credentialInvalid'),
  [MeetingErrorCode.ENDED]: D(MeetingErrorCode.ENDED, 410, 'TERMINAL_ENDED', 'meeting.error.ended', { terminal: true }),
  [MeetingErrorCode.CANCELLED]: D(MeetingErrorCode.CANCELLED, 410, 'TERMINAL_CANCELLED', 'meeting.error.cancelled', { terminal: true }),
  [MeetingErrorCode.TOO_EARLY]: D(MeetingErrorCode.TOO_EARLY, 409, 'SHOW_TOO_EARLY', 'meeting.error.tooEarly', { retriable: true }),
  [MeetingErrorCode.LOCKED]: D(MeetingErrorCode.LOCKED, 423, 'SHOW_LOCKED', 'meeting.error.locked', { retriable: true }),
  [MeetingErrorCode.FULL]: D(MeetingErrorCode.FULL, 409, 'SHOW_FULL', 'meeting.error.full', { retriable: true }),
  [MeetingErrorCode.REMOVED]: D(MeetingErrorCode.REMOVED, 403, 'TERMINAL_REMOVED', 'meeting.error.removed', { terminal: true }),
  [MeetingErrorCode.NOT_SAME_SPACE]: D(MeetingErrorCode.NOT_SAME_SPACE, 403, 'SWITCH_SPACE', 'meeting.error.notSameSpace'),
  [MeetingErrorCode.PASSWORD_REQUIRED]: D(MeetingErrorCode.PASSWORD_REQUIRED, 428, 'SHOW_PASSWORD_CHALLENGE', 'meeting.error.passwordRequired'),
  [MeetingErrorCode.PASSWORD_FORMAT_INVALID]: D(MeetingErrorCode.PASSWORD_FORMAT_INVALID, 422, 'FOCUS_PASSWORD_FORMAT', 'meeting.error.passwordFormatInvalid'),
  [MeetingErrorCode.PASSWORD_INVALID]: D(MeetingErrorCode.PASSWORD_INVALID, 401, 'SHOW_PASSWORD_INVALID', 'meeting.error.passwordInvalid', { countsPasswordAttempt: true }),
  [MeetingErrorCode.PASSWORD_COOLDOWN]: D(MeetingErrorCode.PASSWORD_COOLDOWN, 429, 'SHOW_COOLDOWN', 'meeting.error.passwordCooldown', { retriable: true }),
  [MeetingErrorCode.PASSWORD_PASS_EXPIRED]: D(MeetingErrorCode.PASSWORD_PASS_EXPIRED, 401, 'RESTART_CHALLENGE', 'meeting.error.passwordPassExpired'),
  [MeetingErrorCode.PASSWORD_IMMUTABLE]: D(MeetingErrorCode.PASSWORD_IMMUTABLE, 409, 'DISABLE_PASSWORD_EDIT', 'meeting.error.passwordImmutable'),
  [MeetingErrorCode.FORBIDDEN]: D(MeetingErrorCode.FORBIDDEN, 403, 'REFRESH_CAPABILITY', 'meeting.error.forbidden'),
  [MeetingErrorCode.VERSION_CONFLICT]: D(MeetingErrorCode.VERSION_CONFLICT, 409, 'REFETCH_RECONCILE', 'meeting.error.versionConflict'),
  [MeetingErrorCode.IDEMPOTENCY_CONFLICT]: D(MeetingErrorCode.IDEMPOTENCY_CONFLICT, 409, 'STOP_RETRY', 'meeting.error.idempotencyConflict'),
  [MeetingErrorCode.SHARE_CONFLICT]: D(MeetingErrorCode.SHARE_CONFLICT, 409, 'SHOW_SHARE_CONFLICT', 'meeting.error.shareConflict'),
  [MeetingErrorCode.LIVEKIT_UNAVAILABLE]: D(MeetingErrorCode.LIVEKIT_UNAVAILABLE, 503, 'RETRY_FINALIZE', 'meeting.error.livekitUnavailable', { retriable: true }),
  [MeetingErrorCode.NOTIFICATION_DEFERRED]: D(MeetingErrorCode.NOTIFICATION_DEFERRED, 202, 'WARN_NON_BLOCKING', 'meeting.error.notificationDeferred'),
  [MeetingErrorCode.TIME_INVALID]: D(MeetingErrorCode.TIME_INVALID, 422, 'HIGHLIGHT_TIME', 'meeting.error.timeInvalid'),
  [MeetingErrorCode.RATE_LIMITED]: D(MeetingErrorCode.RATE_LIMITED, 429, 'RATE_LIMIT_COUNTDOWN', 'meeting.error.rateLimited', { retriable: true }),
  [MeetingErrorCode.INTERNAL]: D(MeetingErrorCode.INTERNAL, 500, 'GENERIC_RETRY', 'meeting.error.internal', { retriable: true }),
};

export function isMeetingErrorCode(code: unknown): code is MeetingErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(MEETING_ERROR_TABLE, code);
}

export function directiveForCode(code: MeetingErrorCode): MeetingErrorDirective {
  return MEETING_ERROR_TABLE[code];
}
