// Meeting DTOs and endpoint map.
//
// PROVENANCE / BLOCKER: these types are transcribed from the approved design
// (architecture SHA f0f482c0, frontend appendix §6.3 endpoint mirror). The
// authoritative artifact is the *service-owned* versioned OpenAPI/error snapshot
// that XIN-1773 (standalone octo-meeting-service bootstrap) will publish. Until
// that snapshot exists, `contracts.ts` MUST be treated as provisional: generate
// or byte-align it against the snapshot, then delete this note. octo-server /
// dmworkim do NOT own the Meeting contract. Do NOT invent a parallel contract.
//
// Wire is snake_case (UTC ISO-8601). Conversion to/from camelCase happens in
// exactly one place — service/adapter.ts. Components, MSW handlers and contract
// tests never use a second field-name set.

// ── Canonical service-relative paths (§6.3). The gateway mounts these under
//    /meeting/api/v1; MeetingApiClient prefixes BASE and the gateway forwards
//    to octo-meeting-service /v1/... — clients never hit the internal host. ──
export const MEETING_API_BASE = '/meeting/api/v1';

export const MeetingEndpoint = {
  quickCreate: '/v1/meetings/quick-create', // the only quick-create; plural
  create: '/v1/meetings',
  patch: (id: string) => `/v1/meetings/${id}`,
  cancel: (id: string) => `/v1/meetings/${id}/cancel`,
  list: '/v1/meetings', // ?view=upcoming|history&page_size=&page_token=
  get: (id: string) => `/v1/meetings/${id}`,
  evaluate: '/v1/meetings/admission/evaluate',
  passwordVerify: '/v1/meetings/password/verify',
  finalize: '/v1/meetings/admission/finalize',
  leave: (id: string) => `/v1/meetings/${id}/participants/me/leave`,
  role: (id: string, uid: string) => `/v1/meetings/${id}/participants/${uid}/role`,
  mute: (id: string) => `/v1/meetings/${id}/controls/mute`,
  removeParticipant: (id: string, uid: string) => `/v1/meetings/${id}/participants/${uid}`,
  lock: (id: string) => `/v1/meetings/${id}/lock`,
  end: (id: string) => `/v1/meetings/${id}/end`,
  share: (id: string) => `/v1/meetings/${id}/share`,
  invites: (id: string) => `/v1/meetings/${id}/invites`,
} as const;

export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
// No `live_pending`: quick meetings stay `scheduled` until the first successful
// finalize (FD-05). The frontend never infers status.

export type MeetingRole = 'host' | 'cohost' | 'member'; // H / C / M
export type AdmissionSource = 'list' | 'number' | 'link' | 'rejoin';
export type MeetingEndReason = 'empty_timeout' | 'no_show' | 'host_end' | 'cancelled';

// ── Domain (camelCase) — the only shape components/hooks see. ──
export interface Meeting {
  meetingId: string;
  meetingNumber?: string;
  title: string;
  status: MeetingStatus;
  version: number;
  passwordEnabled: boolean;
  scheduledStartAt?: string; // UTC ISO-8601
  scheduledEndAt?: string;
  maxParticipants?: number;
  role?: MeetingRole;
  joinLink?: string; // only returned to authorized callers under service policy
  createdBy?: string;
}

export interface Participant {
  uid: string;
  displayName?: string;
  role: MeetingRole;
  joinAt?: string;
  muted?: boolean;
  sharing?: boolean;
  superseded?: boolean;
  leftAt?: string;
}

// evaluate — one credential of {meetingId | meetingNumber | linkToken}.
export interface AdmissionEvaluateRequest {
  source: AdmissionSource;
  meetingId?: string;
  meetingNumber?: string;
  linkToken?: string;
  deviceIdHash?: string;
}

// eligible response. Ineligible responses surface a MeetingErrorCode instead and
// NEVER echo meetingId / passwordRequired (FD-27).
export interface AdmissionEvaluateResult {
  eligible: boolean;
  meetingId?: string;
  passwordRequired?: boolean;
  passwordChallengeId?: string;
  allowedToPrejoin?: boolean; // = eligible AND NOT passwordRequired (N1)
  version?: number;
  earliestJoinAt?: string; // scheduled_start_at - 600s, when TOO_EARLY
}

export interface PasswordVerifyRequest {
  meetingId: string;
  passwordChallengeId: string;
  password: string; // 6 digits; never persisted anywhere
}

export interface PasswordVerifyResult {
  passwordPassToken: string; // memory only; consumed on successful finalize
  expiresAt: string;
}

export interface AdmissionFinalizeRequest {
  meetingId: string;
  source: AdmissionSource;
  passwordPassToken?: string;
  deviceIdHash?: string;
  version?: number; // If-Match carrier for rejoin reconcile
}

export interface AdmissionFinalizeResult {
  livekitUrl: string;
  livekitToken: string;
  segmentId: string;
  role: MeetingRole;
}

export interface MeetingListResult {
  meetings: Meeting[];
  nextPageToken?: string;
}

export interface QuickCreateRequest {
  title?: string;
  passwordEnabled?: boolean;
  password?: string; // 6 digits; adapter drops it from any log/telemetry
}

export interface ScheduleCreateRequest {
  title: string;
  scheduledStartAt: string;
  scheduledEndAt?: string;
  passwordEnabled?: boolean;
  password?: string;
  maxParticipants?: number;
  inviteeUids?: string[];
}

// Canonical wire error envelope (§6.4). Absence of `code` on a 404 is the
// gateway-route-missing signal (§6.2), distinct from CREDENTIAL_INVALID.
export interface WireError {
  code?: string;
  message?: string;
  request_id?: string;
  attempts_remaining?: number;
  retry_at?: string;
  retry_after?: number;
  earliest_join_at?: string;
  holder_uid?: string;
  max_participants?: number;
  server_now?: string;
  expires_at?: string;
  password_challenge_id?: string;
}
