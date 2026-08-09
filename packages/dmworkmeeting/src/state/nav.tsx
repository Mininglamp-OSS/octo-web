import React from 'react';
import { WKApp } from '@octo/base';
import type { AdmissionSource } from '../service/contracts';
import QuickSetup from '../pages/QuickSetup';
import SchedulePage from '../pages/SchedulePage';
import JoinEntry from '../pages/JoinEntry';
import JoinFlow from '../pages/JoinFlow';

// Navigation via the supported host route stack (WKApp.routeRight), not inert
// window.history mutations. Kept in one module so pages don't each reach into
// WKApp and so tests can spy on a single seam. (These pages import nav in turn;
// the ES-module cycle is safe because bindings are only used at call time.)

export interface JoinFlowParams {
  source: AdmissionSource;
  meetingId?: string;
  meetingNumber?: string;
  linkToken?: string;
}

type Nav = {
  push: (el: React.ReactElement) => void;
  popToRoot: () => void;
};

function nav(): Nav {
  const w = WKApp as unknown as { routeRight?: Partial<Nav> };
  return {
    push: (el) => w.routeRight?.push?.(el),
    popToRoot: () => w.routeRight?.popToRoot?.(),
  };
}

export function openQuickSetup(): void {
  nav().push(<QuickSetup />);
}
export function openSchedule(): void {
  nav().push(<SchedulePage />);
}
export function openJoinEntry(): void {
  nav().push(<JoinEntry />);
}
export function openJoinFlow(params: JoinFlowParams, dev: string): void {
  nav().push(<JoinFlow {...params} deviceIdHash={dev} autoStart />);
}
export function backToHome(): void {
  nav().popToRoot();
}

/** Best-effort per-device hash for reconnect grace / superseded detection
 * (§9, B-3). Never a security identity; the server owns segment/leave_at. */
export function deviceIdHash(): string {
  const w = WKApp as unknown as { shared?: { deviceId?: string } };
  return w.shared?.deviceId ?? 'web';
}

/** Parse a cold-load / back-forward URL into join credentials. Deep links only
 * ever carry link_token or a meeting number — never a password (§4, §8). */
export function parseJoinQuery(search: string): JoinFlowParams | null {
  const params = new URLSearchParams(search || '');
  const linkToken = params.get('link_token') ?? undefined;
  if (linkToken) return { source: 'link', linkToken };
  const number = params.get('meeting_number') ?? params.get('number') ?? undefined;
  if (number) return { source: 'number', meetingNumber: number };
  return null;
}
