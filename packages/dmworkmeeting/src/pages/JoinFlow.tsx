import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@octo/base';
import { MeetingApiClient, newIdempotencyKey } from '../service/MeetingApiClient';
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
import Blocked from '../components/Blocked';
import ServiceUnavailable from '../components/ServiceUnavailable';
import { useCooldownClock } from '../state/useCooldownClock';
import { backToHome } from '../state/nav';

export interface JoinFlowProps {
  /** Deep-link inputs; only ONE credential is ever supplied (§4). */
  source: AdmissionSource;
  meetingId?: string;
  meetingNumber?: string;
  linkToken?: string;
  deviceIdHash: string;
  /** Begin evaluate immediately on mount (used when navigated with a credential). */
  autoStart?: boolean;
}

/**
 * Admission orchestrator (§7). Drives idle→evaluate→challenge→prejoin→finalize
 * →room, honouring: password never shown until evaluate says so; pass_token
 * consumed only on successful finalize; LIVEKIT_UNAVAILABLE keeps PreJoin and
 * retries with the SAME idempotency key; step-1 recheck at finalize (FD-32) →
 * terminal or blocked; every other canonical error → blocked/serviceUnavailable
 * (never a hang, never a false "ended").
 */
export default function JoinFlow(props: JoinFlowProps) {
  const [state, setState] = useState<MeetingUiState>('idle');
  const [meetingId, setMeetingId] = useState<string | undefined>(props.meetingId);
  const [challengeId, setChallengeId] = useState<string>();
  const [errorCode, setErrorCode] = useState<MeetingErrorCode>();
  const [errorValues, setErrorValues] = useState<Record<string, string | number>>();
  const [serviceKind, setServiceKind] = useState<'service-unavailable' | 'gateway-missing'>();
  const [retryAfter, setRetryAfter] = useState<number>();
  const [cooldown, setCooldown] = useState<CooldownState>(initialCooldownState());
  const [lastInvalid, setLastInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Memory-only pass token — never persisted (§8).
  const passTokenRef = useRef<string | undefined>(undefined);
  // ONE explicit Idempotency-Key reused across finalize retries; rotated on
  // success so a later finalize is a fresh operation (#6, N3, FD-11).
  const finalizeKeyRef = useRef<string>(newIdempotencyKey());

  const dispatch = useCallback((event: Parameters<typeof nextMeetingState>[1]) => {
    setState((prev: MeetingUiState) => nextMeetingState(prev, event));
  }, []);

  // Route every failure to a defined UI state — no branch may leave the flow
  // hanging on a spinner (#4).
  const handleFailure = useCallback(
    (err: unknown) => {
      const decision = classifyFailure(err);
      const wire = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
      switch (decision.kind) {
        case 'auth':
          // 401 auth: the client already logged out; park terminal.
          dispatch({ type: 'AUTH_REQUIRED' });
          return;
        case 'gateway-missing':
          setServiceKind('gateway-missing');
          dispatch({ type: 'SERVICE_UNAVAILABLE' });
          return;
        case 'service-unavailable':
          setServiceKind('service-unavailable');
          setRetryAfter(decision.retryAfter);
          dispatch({ type: 'SERVICE_UNAVAILABLE' });
          return;
        case 'space':
          setErrorCode(decision.code ?? MeetingErrorCode.NOT_SAME_SPACE);
          dispatch({ type: 'BLOCKED', code: decision.code ?? MeetingErrorCode.NOT_SAME_SPACE });
          return;
        case 'canonical': {
          const code = decision.code as MeetingErrorCode;
          setErrorCode(code);
          if (code === MeetingErrorCode.TOO_EARLY && wire?.earliest_join_at) {
            setErrorValues({ earliestJoinAt: String(wire.earliest_join_at) });
          }
          dispatch({ type: 'EVALUATE_INELIGIBLE', code });
          return;
        }
        default:
          // Network / unknown → recoverable internal error, retry allowed.
          setErrorCode(MeetingErrorCode.INTERNAL);
          dispatch({ type: 'BLOCKED', code: MeetingErrorCode.INTERNAL });
      }
    },
    [dispatch],
  );

  const runEvaluate = useCallback(async () => {
    setErrorCode(undefined);
    setErrorValues(undefined);
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

  useEffect(() => {
    if (props.autoStart) void runEvaluate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const code = classifyFailure(err).code;
        const wire = (err as { response?: { data?: { attempts_remaining?: number; retry_at?: string } } }).response?.data;
        if (code === MeetingErrorCode.PASSWORD_INVALID) {
          const next = reduceWrongPassword({
            attemptsRemaining: wire?.attempts_remaining ?? 0,
            retryAtMs: wire?.retry_at ? Date.parse(wire.retry_at) : undefined,
          });
          setCooldown(next);
          setLastInvalid(true);
          dispatch({ type: 'PASSWORD_INVALID', enteringCooldown: next.inCooldown });
        } else if (code === MeetingErrorCode.PASSWORD_COOLDOWN) {
          setCooldown({ attemptsRemaining: 0, inCooldown: true, retryAtMs: wire?.retry_at ? Date.parse(wire.retry_at) : undefined });
          dispatch({ type: 'PASSWORD_INVALID', enteringCooldown: true });
        } else if (code === MeetingErrorCode.PASSWORD_FORMAT_INVALID) {
          dispatch({ type: 'PASSWORD_FORMAT_INVALID' }); // not counted
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
      await MeetingApiClient.finalize(
        {
          meetingId,
          source: props.source,
          passwordPassToken: passTokenRef.current,
          deviceIdHash: props.deviceIdHash,
        },
        { idempotencyKey: finalizeKeyRef.current },
      );
      passTokenRef.current = undefined; // consumed exactly once on success
      finalizeKeyRef.current = newIdempotencyKey(); // rotate after success
      dispatch({ type: 'FINALIZE_SUCCESS' });
    } catch (err) {
      const code = classifyFailure(err).code;
      const wire = (err as { response?: { data?: { retry_after?: number } } }).response?.data;
      if (code === MeetingErrorCode.LIVEKIT_UNAVAILABLE) {
        setRetryAfter(wire?.retry_after); // keep PreJoin + token, reuse same finalize key on retry
        dispatch({ type: 'FINALIZE_LIVEKIT_UNAVAILABLE' });
      } else if (code === MeetingErrorCode.PASSWORD_PASS_EXPIRED) {
        passTokenRef.current = undefined;
        dispatch({ type: 'FINALIZE_PASS_EXPIRED' }); // restart challenge
      } else if (code) {
        setErrorCode(code);
        dispatch({ type: 'FINALIZE_STEP1', code }); // FD-32: terminal or blocked per directive
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

  const cooldownSeconds = useMemo(
    () => (cooldown.retryAtMs ? Math.max(0, Math.ceil((cooldown.retryAtMs - Date.now()) / 1000)) : 0),
    [cooldown],
  );

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
    return (
      <div className="meeting-join-flow" role="status" aria-live="polite" aria-busy="true">
        {t('meeting.room.reconnecting')}
      </div>
    );
  }
  if (state === 'serviceUnavailable') {
    return <ServiceUnavailable reason={serviceKind ?? 'service-unavailable'} retryAfter={retryAfter} onRetry={runEvaluate} />;
  }
  if (state === 'terminal') {
    return <Terminal reason={errorCode ? reasonForCode(errorCode) : 'ended'} onBackHome={backToHome} />;
  }
  if (state === 'blocked') {
    return (
      <Blocked
        code={errorCode ?? MeetingErrorCode.INTERNAL}
        values={errorValues}
        onRetry={() => {
          dispatch({ type: 'RETRY' });
          void runEvaluate();
        }}
        onBackHome={backToHome}
      />
    );
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
  // room / reconnecting are owned by RoomView once finalize succeeds.
  return <div className="meeting-room-placeholder">{t('meeting.room.participants')}</div>;
}
