import React, { useEffect, useRef, useState } from 'react';
import { t, WKApp } from '@octo/base';
import { MeetingApiClient } from '../service/MeetingApiClient';
import type { Meeting } from '../service/contracts';
import { classifyFailure } from '../service/failClosed';
import ServiceUnavailable from '../components/ServiceUnavailable';
import { openQuickSetup, openSchedule, openJoinEntry, openJoinFlow, openDetail } from '../state/nav';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Meeting home: upcoming + history lists with quick / schedule / join entries
 * (§4). Server state is read-only cache; a Space change, auth change, or tab
 * re-activation clears and refetches. Fail-closed rendering for gateway-missing
 * / service-down; a generic failure shows an explicit error (never a false
 * "no meetings").
 */
export default function MeetingHome() {
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const [history, setHistory] = useState<Meeting[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [unavailable, setUnavailable] = useState<'service-unavailable' | 'gateway-missing' | null>(null);
  // Monotonic guard so a stale-Space in-flight load cannot paint the wrong
  // Space's meetings if it resolves after a newer load.
  const loadSeq = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useRef<() => void>(() => {});
  load.current = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = (loadSeq.current += 1);
    setState('loading');
    setUnavailable(null);
    void Promise.all([
      MeetingApiClient.listMeetings('upcoming', { signal: controller.signal }),
      MeetingApiClient.listMeetings('history', { signal: controller.signal }),
    ])
      .then(([up, hist]) => {
        if (seq !== loadSeq.current) return; // superseded by a newer load
        setUpcoming(up.meetings);
        setHistory(hist.meetings);
        setState('ready');
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        const decision = classifyFailure(err);
        if (decision.kind === 'gateway-missing') setUnavailable('gateway-missing');
        else if (decision.kind === 'service-unavailable') setUnavailable('service-unavailable');
        setState('error');
      });
  };

  useEffect(() => {
    load.current();
    const refetch = () => load.current();
    const onMenuActivated = (payload: unknown) => {
      if ((payload as { menuId?: string })?.menuId === 'meeting') load.current();
    };
    WKApp.mittBus.on('space-changed', refetch);
    WKApp.mittBus.on('wk:auth-state-changed', refetch);
    // Left panes stay mounted (display toggled); refresh when the tab is re-activated.
    WKApp.mittBus.on('wk:nav-menu-activated', onMenuActivated);
    return () => {
      controllerRef.current?.abort();
      WKApp.mittBus.off('space-changed', refetch);
      WKApp.mittBus.off('wk:auth-state-changed', refetch);
      WKApp.mittBus.off('wk:nav-menu-activated', onMenuActivated);
    };
  }, []);

  const joinFromList = (m: Meeting) => openJoinFlow({ source: 'list', meetingId: m.meetingId });
  const openMeeting = (m: Meeting) => openDetail(m.meetingId);

  if (unavailable) {
    return <ServiceUnavailable reason={unavailable} onRetry={() => load.current()} />;
  }

  return (
    <div className="meeting-home">
      <header className="meeting-home-actions">
        <h1>{t('meeting.home.title')}</h1>
        <button type="button" onClick={openQuickSetup}>
          {t('meeting.home.quick')}
        </button>
        <button type="button" onClick={openSchedule}>
          {t('meeting.home.schedule')}
        </button>
        <button type="button" onClick={openJoinEntry}>
          {t('meeting.home.join')}
        </button>
      </header>

      {state === 'error' && (
        <div className="meeting-home-error" role="alert" aria-live="assertive">
          <p>{t('meeting.error.internal')}</p>
          <button type="button" onClick={() => load.current()}>
            {t('meeting.service.retry')}
          </button>
        </div>
      )}

      <section aria-label={t('meeting.home.upcoming')}>
        <h2>{t('meeting.home.upcoming')}</h2>
        {state === 'loading' ? (
          <p role="status">…</p>
        ) : state === 'ready' ? (
          <MeetingList meetings={upcoming} onSelect={joinFromList} actionLabel={t('meeting.home.join')} />
        ) : null}
      </section>

      <section aria-label={t('meeting.home.history')}>
        <h2>{t('meeting.home.history')}</h2>
        {state === 'ready' ? <MeetingList meetings={history} onSelect={openMeeting} /> : null}
      </section>
    </div>
  );
}

function MeetingList({
  meetings,
  onSelect,
  actionLabel,
}: {
  meetings: Meeting[];
  onSelect: (m: Meeting) => void;
  actionLabel?: string;
}) {
  if (meetings.length === 0) return <p className="meeting-empty">{t('meeting.home.empty')}</p>;
  return (
    <ul className="meeting-list">
      {meetings.map((m) => (
        <li key={m.meetingId} className="meeting-list-item">
          <button type="button" className="meeting-list-open" onClick={() => onSelect(m)}>
            <span className="meeting-list-title">{m.title}</span>
            <span className="meeting-list-status" data-status={m.status}>
              {m.status}
            </span>
            {actionLabel && <span className="meeting-list-action">{actionLabel}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
