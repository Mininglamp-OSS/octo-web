// UI admission state machine (frontend appendix §7). Pure transition function so
// every edge is unit-testable. The media layer (LiveKit) never drives business
// admission — evaluate/finalize verdicts do.

import { MeetingErrorCode } from '../service/errors';
import { directiveForCode } from '../service/errors';

export type MeetingUiState =
  | 'idle'
  | 'evaluating'
  | 'challenge'
  | 'verifying'
  | 'cooldown'
  | 'prejoin'
  | 'finalizing'
  | 'room'
  | 'reconnecting'
  | 'blocked' // recoverable: locked / full / too-early / rate-limited / conflict / network
  | 'terminal' // ended / left / removed / superseded / cancelled / no-show / empty-timeout
  | 'serviceUnavailable';

export type MeetingUiEvent =
  | { type: 'START_EVALUATE' }
  | { type: 'EVALUATE_ELIGIBLE'; passwordRequired: boolean }
  | { type: 'EVALUATE_INELIGIBLE'; code: MeetingErrorCode }
  | { type: 'SUBMIT_PASSWORD' }
  | { type: 'PASSWORD_PASS' }
  | { type: 'PASSWORD_INVALID'; enteringCooldown: boolean }
  | { type: 'PASSWORD_FORMAT_INVALID' } // never counts, stays on challenge
  | { type: 'COOLDOWN_EXPIRED' }
  | { type: 'START_FINALIZE' }
  | { type: 'FINALIZE_SUCCESS' }
  | { type: 'FINALIZE_LIVEKIT_UNAVAILABLE' } // stay in prejoin, retry
  | { type: 'FINALIZE_PASS_EXPIRED' } // restart challenge
  | { type: 'FINALIZE_PASSWORD_REQUIRED' } // step-1 recheck now requires a password → challenge
  | { type: 'FINALIZE_STEP1'; code: MeetingErrorCode } // predicate changed → terminal or specific state
  | { type: 'BLOCKED'; code: MeetingErrorCode } // recoverable non-terminal error
  | { type: 'RETRY' } // leave blocked → re-evaluate
  | { type: 'SDK_DISCONNECT' } // same-endpoint reconnect attempt
  | { type: 'RECONNECT_OK' }
  | { type: 'RECONNECT_EXPIRED' } // >15s / new endpoint → re-evaluate
  | { type: 'LEFT' }
  | { type: 'ENDED' }
  | { type: 'REMOVED' }
  | { type: 'SUPERSEDED' }
  | { type: 'AUTH_REQUIRED' } // fail-closed → handled outside (logout); state parks terminal
  | { type: 'SERVICE_UNAVAILABLE' }
  | { type: 'RESET' };

/** Codes that, when returned by a step-1 recheck at finalize (FD-32), map to a
 * terminal state rather than a recoverable one. */
export function isTerminalCode(code: MeetingErrorCode): boolean {
  return directiveForCode(code).terminal;
}

export function nextMeetingState(state: MeetingUiState, event: MeetingUiEvent): MeetingUiState {
  switch (event.type) {
    case 'RESET':
      return 'idle';
    case 'AUTH_REQUIRED':
      return 'terminal';
    case 'SERVICE_UNAVAILABLE':
      return 'serviceUnavailable';
    case 'START_EVALUATE':
      return 'evaluating';
    case 'EVALUATE_ELIGIBLE':
      return event.passwordRequired ? 'challenge' : 'prejoin';
    case 'EVALUATE_INELIGIBLE':
      // Terminal codes (ended/cancelled/removed) end the flow; every other
      // ineligible code is recoverable and renders the blocked view — it must
      // never hang or be shown as "ended".
      return isTerminalCode(event.code) ? 'terminal' : 'blocked';
    case 'SUBMIT_PASSWORD':
      return state === 'challenge' ? 'verifying' : state;
    case 'PASSWORD_PASS':
      return 'prejoin';
    case 'PASSWORD_INVALID':
      return event.enteringCooldown ? 'cooldown' : 'challenge';
    case 'PASSWORD_FORMAT_INVALID':
      return 'challenge';
    case 'COOLDOWN_EXPIRED':
      return 'challenge';
    case 'START_FINALIZE':
      return state === 'prejoin' ? 'finalizing' : state;
    case 'FINALIZE_SUCCESS':
      return 'room';
    case 'FINALIZE_LIVEKIT_UNAVAILABLE':
      return 'prejoin'; // keep PreJoin + pass_token; retry finalize
    case 'FINALIZE_PASS_EXPIRED':
      return 'challenge'; // restart challenge
    case 'FINALIZE_PASSWORD_REQUIRED':
      return 'challenge'; // step-1 recheck now requires a password
    case 'FINALIZE_STEP1':
      return isTerminalCode(event.code) ? 'terminal' : 'blocked';
    case 'BLOCKED':
      return 'blocked';
    case 'RETRY':
      return 'evaluating';
    case 'SDK_DISCONNECT':
      return state === 'room' ? 'reconnecting' : state;
    case 'RECONNECT_OK':
      return 'room';
    case 'RECONNECT_EXPIRED':
      return 'evaluating'; // re-evaluate with source=rejoin
    case 'LEFT':
    case 'ENDED':
    case 'REMOVED':
    case 'SUPERSEDED':
      return 'terminal';
    default:
      return state;
  }
}
