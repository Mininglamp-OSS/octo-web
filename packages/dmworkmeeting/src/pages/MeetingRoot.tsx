import React, { useCallback, useEffect, useState } from 'react';
import { t } from '@octo/base';
import { MeetingApiClient } from '../service/MeetingApiClient';
import type { Meeting } from '../service/contracts';
import { classifyFailure } from '../service/failClosed';
import { directiveForCode } from '../service/errors';
import { MEETING_NAV_EVENT, openDetail, openHome, parseJoinQuery } from '../state/nav';
import MeetingHome from './MeetingHome';
import QuickSetup from './QuickSetup';
import SchedulePage from './SchedulePage';
import JoinEntry from './JoinEntry';
import JoinFlow from './JoinFlow';
import MeetingDetail from './MeetingDetail';

/**
 * In-shell router for the Meeting module (blocker #1). The host shell only
 * paints the menu's routePath component (this `/meeting` component); it never
 * calls the sub-path handlers previously registered on WKApp.route. So this
 * component owns sub-view routing: it derives the current view from
 * window.location on mount (cold-load deep links), on `popstate` (browser
 * back/forward), and on the module's in-app nav event. All navigation stays
 * inside this one mounted component, which is the surface the shell renders.
 */
export default function MeetingRoot() {
  const [loc, setLoc] = useState(() => currentLoc());

  useEffect(() => {
    const sync = () => setLoc(currentLoc());
    window.addEventListener('popstate', sync);
    window.addEventListener(MEETING_NAV_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(MEETING_NAV_EVENT, sync);
    };
  }, []);

  const { pathname, search } = loc;

  // Exact known sub-paths first, so they never collide with `/meeting/{id}`.
  if (pathname === '/meeting' || pathname === '/meeting/') return <MeetingHome />;
  if (pathname === '/meeting/quick') return <QuickSetup onCreated={(id) => openDetail(id)} />;
  if (pathname === '/meeting/schedule') return <SchedulePage onSaved={(m) => openDetail(m.meetingId)} onCancelled={openHome} />;
  if (pathname === '/meeting/join') {
    const creds = parseJoinQuery(search);
    return creds ? <JoinFlow {...creds} autoStart /> : <JoinEntry />;
  }

  const editMatch = pathname.match(/^\/meeting\/([^/]+)\/edit$/);
  if (editMatch) return <EditLoader meetingId={decodeURIComponent(editMatch[1])} />;

  const detailMatch = pathname.match(/^\/meeting\/([^/]+)$/);
  if (detailMatch) return <MeetingDetail meetingId={decodeURIComponent(detailMatch[1])} />;

  return <MeetingHome />;
}

function currentLoc(): { pathname: string; search: string } {
  if (typeof window === 'undefined') return { pathname: '/meeting', search: '' };
  return { pathname: window.location.pathname, search: window.location.search };
}

/** Loads an existing meeting, then renders the edit form (PATCH + If-Match). */
function EditLoader({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<Meeting>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    MeetingApiClient.getMeeting(meetingId, controller.signal)
      .then(setMeeting)
      .catch((err) => {
        const code = classifyFailure(err).code;
        setError(code ? t(directiveForCode(code).i18nKey) : t('meeting.error.internal'));
      });
    return () => controller.abort();
  }, [meetingId]);

  const onSaved = useCallback((m: Meeting) => openDetail(m.meetingId), []);
  if (error) return <div role="alert" aria-live="assertive">{error}</div>;
  if (!meeting) return <p role="status" aria-busy="true">…</p>;
  return <SchedulePage existing={meeting} onSaved={onSaved} onCancelled={() => openDetail(meetingId)} />;
}
