import React, { useCallback, useMemo, useRef, useState } from 'react';
import { t } from '@octo/base';
import { MeetingApiClient } from '../service/MeetingApiClient';
import type { AdmissionSource } from '../service/contracts';
import { nextMeetingState, type MeetingUiState } from '../logic/stateMachine';
import {
  initialCooldownState,
  reduceWrongPassword,
  clearedCooldownState,
  type CooldownState,
} from '../logic/password';
import { classifyFailure } from '../service/failClosed';
import { directiveForCode, MeetingErrorCode } from '../service/errors';
import PasswordChallenge from '../components/PasswordChallenge';
import DevicePreview from '../components/DevicePreview';
import Terminal, { reasonForCode } from '../components/Terminal';
import ServiceUnavailable from '../components/ServiceUnavailable';
import { useCooldownClock } from '../state/useCooldownClock';

export interface JoinFlowProps {
  /** Deep-link inputs; only ONE credential is ever supplied (§4). */
  source: AdmissionSource;
  meetingId?: string;
  meetingNumber?: string;
  linkToken?: string;
  deviceIdHash: string;
}

/**
 * Admission orchestrator (§7). Drives idle→evaluate→challenge→prejoin→finalize
 * →room, honouring: password never shown until evaluate says so; pass_token
 * consumed only on successful finalize; LIVEKIT_UNAVAILABLE keeps PreJoin and
 * retries; step-1 recheck at finalize (FD-32) → terminal; fail-closed states.
 */
export default function JoinFlow(props: JoinFlowProps) {
  const [state, setState] = useState<MeetingUiState>('idle');
  const [meetingId, setMeetingId] = useState<string | undefined>(props.meetingId);
  const [challengeId, setChallengeId] = useState<string>();
  const [terminalCode, setTerminalCode] = useState<MeetingErrorCode>();
  const [serviceKind, setServiceKind] = useState<'service-unavailable' | 'gateway-missing'>();
  const [retryAfter, setRetryAfter] = useState<number>();
  const [cooldown, setCooldown] = useState<CooldownState>(initialCooldownState());
  const [lastInvalid, setLastInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Memory-only pass token — never persisted (§8).
  const passTokenRef = useRef<string | undefined>(undefined);

  const dispatch = useCallback((event: Parameters<typeof nextMeetingState>[1]) => {
    setState((prev: MeetingUiState) => nextMeetingState(prev, event));
  }, []);

  const handleFailure = useCallback(
    (err: unknown) => {
      const decision = classifyFailure(err);
      if (decision.kind === 'auth') {
        // 401 → the client interceptor already logged out; park terminal.
        dispatch({ type: 'AUTH_REQUIRED' });
        return;
      }
      if (decision.kind === 'gateway-missing') {
        setServiceKind('gateway-missing');
        dispatch({ type: 'SERVICE_UNAVAILABLE' });
        return;
      }
      if (decision.kind === 'service-unavailable') {
        setServiceKind('service-unavailable');
        setRetryAfter(decision.retryAfter);
        dispatch({ type: 'SERVICE_UNAVAILABLE' });
        return;
      }
      if (decision.code) {
        const code = decision.code;
        if (directiveForCode(code).terminal || code === MeetingErrorCode.NOT_SAME_SPACE || code === MeetingErrorCode.CREDENTIAL_INVALID) {
          setTerminalCode(code);
          dispatch({ type: 'EVALUATE_INELIGIBLE', code });
        }
      }
    },
    [dispatch],
  );

  const runEvaluate = useCallback(async () => {
    dispatch({ type: 'START_EVALUATE' });
    try {
      const r = await MeetingApiClient.evaluate({
        source: props.source,
        meetingId: props.meetingId,
        meetingNumber: props.meetingNumber,
        linkToken: props.linkToken,
        deviceIdHash: props.deviceIdHash,
      });
      if (r.meetingId) setMeetingId(r.meetingId);
      if (r.passwordChallengeId) setChallengeId(r.passwordChallengeId);
      dispatch({ type: 'EVALUATE_ELIGIBLE', passwordRequired: Boolean(r.passwordRequired) });
    } catch (err) {
      handleFailure(err);
    }
  }, [dispatch, handleFailure, props.deviceIdHash, props.linkToken, props.meetingId, props.meetingNumber, props.source]);

  const submitPassword = useCallback(
    async (password: string) => {
      if (!meetingId || !challengeId) return;
      setSubmitting(true);
      setLastInvalid(false);
      dispatch({ type: 'SUBMIT_PASSWORD' });
      try {
        const r = await MeetingApiClient.verifyPassword({ meetingId, passwordChallengeId: challengeId, password });
        passTokenRef.current = r.passwordPassToken;
        setCooldown(clearedCooldownState());
        dispatch({ type: 'PASSWORD_PASS' });
      } catch (err) {
        const decision = classifyFailure(err);
        const code = decision.code;
        if (code === MeetingErrorCode.PASSWORD_INVALID) {
          const wire = (err as { response?: { data?: { attempts_remaining?: number; retry_at?: string } } }).response?.data;
          const attemptsRemaining = wire?.attempts_remaining ?? 0;
          const retryAtMs = wire?.retry_at ? Date.parse(wire.retry_at) : undefined;
          const next = reduceWrongPassword({ attemptsRemaining, retryAtMs });
          setCooldown(next);
          setLastInvalid(true);
          dispatch({ type: 'PASSWORD_INVALID', enteringCooldown: next.inCooldown });
        } else if (code === MeetingErrorCode.PASSWORD_COOLDOWN) {
          const wire = (err as { response?: { data?: { retry_at?: string } } }).response?.data;
          setCooldown({ attemptsRemaining: 0, inCooldown: true, retryAtMs: wire?.retry_at ? Date.parse(wire.retry_at) : undefined });
          dispatch({ type: 'PASSWORD_INVALID', enteringCooldown: true });
        } else {
          handleFailure(err);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [challengeId, dispatch, handleFailure, meetingId],
  );

  const runFinalize = useCallback(async () => {
    if (!meetingId) return;
    dispatch({ type: 'START_FINALIZE' });
    try {
      await MeetingApiClient.finalize({
        meetingId,
        source: props.source,
        passwordPassToken: passTokenRef.current,
        deviceIdHash: props.deviceIdHash,
      });
      // Success consumes the pass token exactly once.
      passTokenRef.current = undefined;
      dispatch({ type: 'FINALIZE_SUCCESS' });
    } catch (err) {
      const decision = classifyFailure(err);
      const code = decision.code;
      if (code === MeetingErrorCode.LIVEKIT_UNAVAILABLE) {
        setRetryAfter(decision.retryAfter);
        dispatch({ type: 'FINALIZE_LIVEKIT_UNAVAILABLE' }); // keep PreJoin + token, retry
      } else if (code === MeetingErrorCode.PASSWORD_PASS_EXPIRED) {
        passTokenRef.current = undefined;
        dispatch({ type: 'FINALIZE_PASS_EXPIRED' }); // restart challenge
      } else if (code && directiveForCode(code).httpStatus) {
        setTerminalCode(code);
        dispatch({ type: 'FINALIZE_STEP1', code }); // FD-32 step-1 recheck
      } else {
        handleFailure(err);
      }
    }
  }, [dispatch, handleFailure, meetingId, props.deviceIdHash, props.source]);

  useCooldownClock(cooldown, () => {
    setCooldown(clearedCooldownState());
    setLastInvalid(false);
    dispatch({ type: 'COOLDOWN_EXPIRED' });
  });

  const cooldownSeconds = useMemo(() => (cooldown.retryAtMs ? Math.max(0, Math.ceil((cooldown.retryAtMs - Date.now()) / 1000)) : 0), [cooldown]);

  // ── Render by state ──
  if (state === 'idle') {
    return (
      <div className="meeting-join-flow">
        <button type="button" onClick={runEvaluate}>
          {t('meeting.join.submit')}
        </button>
      </div>
    );
  }
  if (state === 'evaluating' || state === 'finalizing' || state === 'verifying') {
    return <div className="meeting-join-flow" aria-busy="true">…</div>;
  }
  if (state === 'serviceUnavailable') {
    return <ServiceUnavailable reason={serviceKind ?? 'service-unavailable'} retryAfter={retryAfter} onRetry={runEvaluate} />;
  }
  if (state === 'terminal') {
    return <Terminal reason={terminalCode ? reasonForCode(terminalCode) : 'ended'} />;
  }
  if (state === 'challenge' || state === 'cooldown') {
    return (
      <PasswordChallenge
        attemptsRemaining={cooldown.attemptsRemaining}
        inCooldown={state === 'cooldown' || cooldown.inCooldown}
        cooldownRemainingSeconds={cooldownSeconds}
        lastInvalid={lastInvalid}
        submitting={submitting}
        onSubmit={submitPassword}
      />
    );
  }
  if (state === 'prejoin') {
    return (
      <div className="meeting-prejoin">
        <h2>{t('meeting.prejoin.title')}</h2>
        <DevicePreview micOn cameraOn onToggleMic={() => {}} onToggleCamera={() => {}} />
        {retryAfter ? <p role="status">{t('meeting.prejoin.retry', { values: { seconds: retryAfter } })}</p> : null}
        <button type="button" onClick={runFinalize}>
          {t('meeting.prejoin.join')}
        </button>
      </div>
    );
  }
  // room / reconnecting are owned by RoomPage once finalize succeeds.
  return <div className="meeting-room-placeholder">{t('meeting.room.participants')}</div>;
}
