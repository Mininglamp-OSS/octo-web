// The ONE place snake_case wire ⇄ camelCase domain conversion happens (§6.3).
// Nothing else in the module may read a snake_case field. This also centralises
// redaction so passwords / pass tokens never reach logs or telemetry.

import type {
  AdmissionEvaluateRequest,
  AdmissionEvaluateResult,
  AdmissionFinalizeRequest,
  AdmissionFinalizeResult,
  Meeting,
  MeetingListResult,
  Participant,
  PasswordVerifyRequest,
  PasswordVerifyResult,
} from './contracts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const snakeToCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const camelToSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function toCamelDeep<T = unknown>(input: Json): T {
  if (Array.isArray(input)) return input.map((v) => toCamelDeep<Json>(v)) as unknown as T;
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[snakeToCamel(k)] = toCamelDeep(v as Json);
    return out as T;
  }
  return input as unknown as T;
}

export function toSnakeDeep(input: unknown): Json {
  if (Array.isArray(input)) return input.map((v) => toSnakeDeep(v));
  if (input && typeof input === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (v === undefined) continue; // omit undefined so the wire stays clean
      out[camelToSnake(k)] = toSnakeDeep(v);
    }
    return out;
  }
  return (input ?? null) as Json;
}

// ── Typed request encoders. `password` is snake-cased as `password`; the
//    canonical `password_pass_token` maps to `passwordPassToken` (never
//    `passPassToken`). ──
export const encodeEvaluate = (r: AdmissionEvaluateRequest): Json => toSnakeDeep(r);
export const encodePasswordVerify = (r: PasswordVerifyRequest): Json => toSnakeDeep(r);
export const encodeFinalize = (r: AdmissionFinalizeRequest): Json => toSnakeDeep(r);

// ── Typed response decoders. ──
export const decodeMeeting = (w: Json): Meeting => toCamelDeep<Meeting>(w);
export const decodeParticipant = (w: Json): Participant => toCamelDeep<Participant>(w);
export const decodeEvaluate = (w: Json): AdmissionEvaluateResult => toCamelDeep<AdmissionEvaluateResult>(w);
export const decodePasswordVerify = (w: Json): PasswordVerifyResult => toCamelDeep<PasswordVerifyResult>(w);
export const decodeFinalize = (w: Json): AdmissionFinalizeResult => toCamelDeep<AdmissionFinalizeResult>(w);

export function decodeList(w: Json): MeetingListResult {
  const obj = (w && typeof w === 'object' && !Array.isArray(w) ? w : {}) as Record<string, Json>;
  const meetings = Array.isArray(obj.meetings) ? (obj.meetings as Json[]).map(decodeMeeting) : [];
  const nextPageToken = typeof obj.next_page_token === 'string' ? obj.next_page_token : undefined;
  return { meetings, nextPageToken };
}

// Fields that must never appear in logs, telemetry labels, notifications,
// URLs, screenshots or LiveKit metadata (§8, §14).
const SENSITIVE_KEYS = new Set([
  'password',
  'password_pass_token',
  'passwordPassToken',
  'password_challenge_id',
  'passwordChallengeId',
  'link_token',
  'linkToken',
  'livekit_token',
  'livekitToken',
  'token',
]);

/** Deep-clone with sensitive keys removed — the only shape allowed into telemetry/logs. */
export function redactSensitive<T>(input: T): T {
  if (Array.isArray(input)) return input.map((v) => redactSensitive(v)) as unknown as T;
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      out[k] = redactSensitive(v);
    }
    return out as T;
  }
  return input;
}
