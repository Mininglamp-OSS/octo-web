import React, { useEffect, useState } from 'react';
import { t, WKApp } from '@octo/base';
import { MeetingApiClient } from '../service/MeetingApiClient';
import type { Meeting } from '../service/contracts';
import { classifyFailure } from '../service/failClosed';
import ServiceUnavailable from '../components/ServiceUnavailable';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Meeting home: upcoming + history lists with quick / schedule / join entries
 * (§4). Server state is read-only cache; a Space change or auth change clears
 * and refetches. Fail-closed rendering for gateway-missing / service-down.
 */
export default function MeetingHome() {
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const [history, setHistory] = useState<Meeting[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [unavailable, setUnavailable] = useState<'service-unavailable' | 'gateway-missing' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setState('loading');
      setUnavailable(null);
      try {
        const [up, hist] = await Promise.all([
          MeetingApiClient.listMeetings('upcoming', { signal: controller.signal }),
          MeetingApiClient.listMeetings('history', { signal: controller.signal }),
        ]);
        setUpcoming(up.meetings);
        setHistory(hist.meetings);
        setState('ready');
      } catch (err) {
        const decision = classifyFailure(err);
        if (decision.kind === 'gateway-missing') setUnavailable('gateway-missing');
        else if (decision.kind === 'service-unavailable') setUnavailable('service-unavailable');
        setState('error');
      }
    };
    void load();
    // Space / auth changes clear and refetch (§5).
    const onSpaceChanged = () => void load();
    WKApp.mittBus.on('space-changed', onSpaceChanged);
    WKApp.mittBus.on('wk:auth-state-changed', onSpaceChanged);
    return () => {
      controller.abort();
      WKApp.mittBus.off('space-changed', onSpaceChanged);
      WKApp.mittBus.off('wk:auth-state-changed', onSpaceChanged);
    };
  }, []);

  const go = (path: string) => window.history.pushState({}, '', path);

  if (unavailable) {
    return <ServiceUnavailable reason={unavailable} onRetry={() => window.location.reload()} />;
  }

  return (
    <div className="meeting-home">
      <header className="meeting-home-actions">
        <h1>{t('meeting.home.title')}</h1>
        <button type="button" onClick={() => go('/meeting/quick')}>
          {t('meeting.home.quick')}
        </button>
        <button type="button" onClick={() => go('/meeting/schedule')}>
          {t('meeting.home.schedule')}
        </button>
        <button type="button" onClick={() => go('/meeting/join')}>
          {t('meeting.home.join')}
        </button>
      </header>

      <section aria-label={t('meeting.home.upcoming')}>
        <h2>{t('meeting.home.upcoming')}</h2>
        {state === 'loading' ? <p>…</p> : <MeetingList meetings={upcoming} />}
      </section>

      <section aria-label={t('meeting.home.history')}>
        <h2>{t('meeting.home.history')}</h2>
        <MeetingList meetings={history} />
      </section>
    </div>
  );
}

function MeetingList({ meetings }: { meetings: Meeting[] }) {
  if (meetings.length === 0) return <p className="meeting-empty">{t('meeting.home.empty')}</p>;
  return (
    <ul className="meeting-list">
      {meetings.map((m) => (
        <li key={m.meetingId} className="meeting-list-item">
          <span className="meeting-list-title">{m.title}</span>
          <span className="meeting-list-status" data-status={m.status}>
            {m.status}
          </span>
        </li>
      ))}
    </ul>
  );
}
