import { WKApp } from '@octo/base';
import type { AdmissionSource } from '../service/contracts';

// Navigation for the Meeting module. The host shell only paints the menu's
// routePath component (`/meeting` → MeetingRoot); sub-paths registered on
// WKApp.route never render (MainContentLeft renders WKApp.route.get(menu.route
// Path) only — see apps/web/src/Pages/Main/index.tsx). So navigation is
// URL-driven within that single painting component: we push history and emit an
// event MeetingRoot listens to, and MeetingRoot re-derives its view on
// `popstate` (browser back/forward) and on cold load. Deep links, in-app nav
// and back/forward therefore all work through the one component the shell mounts.

export const MEETING_NAV_EVENT = 'meeting:navchange';

export interface JoinFlowParams {
  source: AdmissionSource;
  meetingId?: string;
  meetingNumber?: string;
  linkToken?: string;
}

function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(MEETING_NAV_EVENT));
}

export function openHome(): void {
  navigate('/meeting');
}
export function openQuickSetup(): void {
  navigate('/meeting/quick');
}
export function openSchedule(): void {
  navigate('/meeting/schedule');
}
export function openEdit(meetingId: string): void {
  navigate(`/meeting/${encodeURIComponent(meetingId)}/edit`);
}
export function openDetail(meetingId: string): void {
  navigate(`/meeting/${encodeURIComponent(meetingId)}`);
}
export function openJoinEntry(): void {
  navigate('/meeting/join');
}
export function openJoinFlow(params: JoinFlowParams): void {
  const usp = new URLSearchParams();
  if (params.linkToken) usp.set('link_token', params.linkToken);
  else if (params.meetingNumber) usp.set('meeting_number', params.meetingNumber);
  else if (params.meetingId) usp.set('meeting_id', params.meetingId);
  const q = usp.toString();
  navigate(`/meeting/join${q ? `?${q}` : ''}`);
}
export function backToHome(): void {
  navigate('/meeting');
}

// Small non-cryptographic FNV-1a hash so we never send the raw persisted device
// UUID as `device_id_hash`, and never a shared constant that could grant another
// user's reconnect-grace exemption. Returns undefined when no device id exists
// (fail-safe: the server then cannot grant same-endpoint grace — B-3/FD-29).
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function deviceIdHash(): string | undefined {
  const deviceId = (WKApp as unknown as { shared?: { deviceId?: string } }).shared?.deviceId;
  if (!deviceId) return undefined;
  return fnv1a(`meeting:${deviceId}`);
}

/** Parse a cold-load / back-forward URL into join credentials. Deep links only
 * ever carry link_token / meeting_number / meeting_id — never a password (§4, §8). */
export function parseJoinQuery(search: string): JoinFlowParams | null {
  const params = new URLSearchParams(search || '');
  const linkToken = params.get('link_token') ?? undefined;
  if (linkToken) return { source: 'link', linkToken };
  const number = params.get('meeting_number') ?? params.get('number') ?? undefined;
  if (number) return { source: 'number', meetingNumber: number };
  const meetingId = params.get('meeting_id') ?? undefined;
  if (meetingId) return { source: 'list', meetingId };
  return null;
}
