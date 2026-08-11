import { describe, it, expect, afterEach } from 'vitest';
import { emitMeetingTelemetry, setMeetingTelemetrySink } from './telemetry';

afterEach(() => setMeetingTelemetrySink(null));

describe('telemetry redaction boundary (§14)', () => {
  it('emits endpoint/code labels through the sink', () => {
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    setMeetingTelemetrySink((name, payload) => events.push({ name, payload }));
    emitMeetingTelemetry({ kind: 'error', endpoint: '/v1/meetings/admission/evaluate', httpStatus: 423 });
    expect(events[0].name).toBe('meeting.error');
    expect(events[0].payload).toMatchObject({ endpoint: '/v1/meetings/admission/evaluate', httpStatus: 423 });
  });

  it('is a no-op with no sink wired', () => {
    expect(() => emitMeetingTelemetry({ kind: 'finalize', outcome: 'success' })).not.toThrow();
  });

  it('never lets a stray sensitive field through', () => {
    const seen: Record<string, unknown>[] = [];
    setMeetingTelemetrySink((_n, p) => seen.push(p));
    // Cast through unknown to smuggle a sensitive key past the type and prove redaction.
    emitMeetingTelemetry({ kind: 'finalize', outcome: 'success', password: '123456' } as never);
    expect(JSON.stringify(seen[0])).not.toContain('123456');
  });
});
