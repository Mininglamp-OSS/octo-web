import { describe, it, expect } from 'vitest';
import { nextMeetingState, isTerminalCode, type MeetingUiState } from './stateMachine';
import { MeetingErrorCode } from '../service/errors';

describe('UI state machine (§7)', () => {
  it('idle → evaluating → challenge when password required', () => {
    expect(nextMeetingState('idle', { type: 'START_EVALUATE' })).toBe('evaluating');
    expect(nextMeetingState('evaluating', { type: 'EVALUATE_ELIGIBLE', passwordRequired: true })).toBe('challenge');
  });

  it('eligible without password → prejoin directly', () => {
    expect(nextMeetingState('evaluating', { type: 'EVALUATE_ELIGIBLE', passwordRequired: false })).toBe('prejoin');
  });

  it('ineligible terminal code → terminal; recoverable code → blocked', () => {
    expect(nextMeetingState('evaluating', { type: 'EVALUATE_INELIGIBLE', code: MeetingErrorCode.ENDED })).toBe(
      'terminal',
    );
    expect(nextMeetingState('evaluating', { type: 'EVALUATE_INELIGIBLE', code: MeetingErrorCode.LOCKED })).toBe(
      'blocked',
    );
    expect(nextMeetingState('evaluating', { type: 'EVALUATE_INELIGIBLE', code: MeetingErrorCode.CREDENTIAL_INVALID })).toBe(
      'blocked',
    );
  });

  it('blocked is recoverable: RETRY → evaluating', () => {
    expect(nextMeetingState('blocked', { type: 'RETRY' })).toBe('evaluating');
  });

  it('challenge: submit → verifying → pass → prejoin', () => {
    expect(nextMeetingState('challenge', { type: 'SUBMIT_PASSWORD' })).toBe('verifying');
    expect(nextMeetingState('verifying', { type: 'PASSWORD_PASS' })).toBe('prejoin');
  });

  it('wrong password without cooldown stays on challenge; format-invalid stays on challenge', () => {
    expect(nextMeetingState('verifying', { type: 'PASSWORD_INVALID', enteringCooldown: false })).toBe('challenge');
    expect(nextMeetingState('challenge', { type: 'PASSWORD_FORMAT_INVALID' })).toBe('challenge');
  });

  it('5th wrong password → cooldown → expiry → challenge', () => {
    expect(nextMeetingState('verifying', { type: 'PASSWORD_INVALID', enteringCooldown: true })).toBe('cooldown');
    expect(nextMeetingState('cooldown', { type: 'COOLDOWN_EXPIRED' })).toBe('challenge');
  });

  it('prejoin → finalizing → room on success', () => {
    expect(nextMeetingState('prejoin', { type: 'START_FINALIZE' })).toBe('finalizing');
    expect(nextMeetingState('finalizing', { type: 'FINALIZE_SUCCESS' })).toBe('room');
  });

  it('LIVEKIT_UNAVAILABLE keeps PreJoin (retry, not back to challenge)', () => {
    expect(nextMeetingState('finalizing', { type: 'FINALIZE_LIVEKIT_UNAVAILABLE' })).toBe('prejoin');
  });

  it('pass-token expiry at finalize → back to challenge (restart)', () => {
    expect(nextMeetingState('finalizing', { type: 'FINALIZE_PASS_EXPIRED' })).toBe('challenge');
  });

  it('finalize step-1 recheck (FD-32): terminal code → terminal, recoverable code → blocked', () => {
    expect(nextMeetingState('finalizing', { type: 'FINALIZE_STEP1', code: MeetingErrorCode.REMOVED })).toBe('terminal');
    expect(nextMeetingState('finalizing', { type: 'FINALIZE_STEP1', code: MeetingErrorCode.LOCKED })).toBe('blocked');
  });

  it('room reconnect: SDK disconnect → reconnecting → ok → room', () => {
    expect(nextMeetingState('room', { type: 'SDK_DISCONNECT' })).toBe('reconnecting');
    expect(nextMeetingState('reconnecting', { type: 'RECONNECT_OK' })).toBe('room');
  });

  it('room reconnect expiry → re-evaluate', () => {
    expect(nextMeetingState('reconnecting', { type: 'RECONNECT_EXPIRED' })).toBe('evaluating');
  });

  it.each(['LEFT', 'ENDED', 'REMOVED', 'SUPERSEDED'] as const)('%s → terminal', (type) => {
    expect(nextMeetingState('room', { type } as never)).toBe('terminal');
  });

  it('auth-required and service-unavailable are reachable from any state', () => {
    const states: MeetingUiState[] = ['idle', 'challenge', 'prejoin', 'room'];
    for (const s of states) {
      expect(nextMeetingState(s, { type: 'AUTH_REQUIRED' })).toBe('terminal');
      expect(nextMeetingState(s, { type: 'SERVICE_UNAVAILABLE' })).toBe('serviceUnavailable');
    }
  });
});

describe('terminal code classification (FD-32)', () => {
  it.each([MeetingErrorCode.ENDED, MeetingErrorCode.CANCELLED, MeetingErrorCode.REMOVED])(
    '%s is terminal',
    (code) => expect(isTerminalCode(code)).toBe(true),
  );
  it.each([MeetingErrorCode.LOCKED, MeetingErrorCode.FULL, MeetingErrorCode.TOO_EARLY])(
    '%s is recoverable (not terminal)',
    (code) => expect(isTerminalCode(code)).toBe(false),
  );
});
