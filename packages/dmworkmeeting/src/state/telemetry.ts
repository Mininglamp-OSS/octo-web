import { redactSensitive } from '../service/adapter';
import type { MeetingErrorCode } from '../service/errors';

// Telemetry boundary (§14): events are keyed by endpoint / error code / meeting
// status ONLY. meeting_id, user_id, passwords, pass tokens and raw link/LiveKit
// tokens must NEVER appear as labels or payload. All payloads pass through
// redactSensitive as a defensive backstop.

export type MeetingTelemetryEvent =
  | { kind: 'admission_evaluate'; source: string; outcome: 'eligible' | 'ineligible'; code?: MeetingErrorCode }
  | { kind: 'finalize'; outcome: 'success' | 'retry' | 'failed'; code?: MeetingErrorCode }
  | { kind: 'password_attempt'; outcome: 'pass' | 'invalid' | 'cooldown' }
  | { kind: 'error'; endpoint: string; code?: MeetingErrorCode; httpStatus?: number };

type Sink = (name: string, payload: Record<string, unknown>) => void;

let sink: Sink | null = null;

/** Wire a telemetry sink (defaults to no-op). Host app injects its reporter. */
export function setMeetingTelemetrySink(fn: Sink | null): void {
  sink = fn;
}

export function emitMeetingTelemetry(event: MeetingTelemetryEvent): void {
  if (!sink) return;
  const { kind, ...rest } = event;
  // Redact defensively even though the event shape carries no sensitive fields.
  sink(`meeting.${kind}`, redactSensitive(rest as Record<string, unknown>));
}
