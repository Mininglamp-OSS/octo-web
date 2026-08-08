import React from 'react';
import type { IModule } from '@octo/base';
import { i18n, WKApp, Menus, t as translate } from '@octo/base';
import MeetingHome from './pages/MeetingHome';
import QuickSetup from './pages/QuickSetup';
import JoinFlow from './pages/JoinFlow';
import enUS from './i18n/en-US.json';
import zhCN from './i18n/zh-CN.json';
import type { AdmissionSource } from './service/contracts';

// Top-level feature flag (§14): MEETING_FEATURE_ENABLED. When off, the menu is
// hidden. Read from the injected runtime config; default enabled so the module
// registers routes but the menu factory can hide the entry.
function isMeetingFeatureEnabled(): boolean {
  const cfg = (WKApp as unknown as { config?: { meetingFeatureEnabled?: boolean } }).config;
  return cfg?.meetingFeatureEnabled !== false;
}

function MeetingMenuIcon({ active }: { active?: boolean }) {
  const color = active ? 'var(--wk-brand-primary, #7C5CFC)' : 'currentColor';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" />
      <rect x="3" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Best-effort per-device hash used for reconnect grace / superseded detection
 * (§9, B-3). Never a security identity; the server owns the authoritative
 * segment/leave_at. */
function deviceIdHash(): string {
  const w = WKApp as unknown as { shared?: { deviceId?: string } };
  return w.shared?.deviceId ?? 'web';
}

export class MeetingModule implements IModule {
  id(): string {
    return 'MeetingModule';
  }

  init(): void {
    i18n.registerNamespace('meeting', { 'zh-CN': zhCN, 'en-US': enUS });

    WKApp.route.register('/meeting', () => <MeetingHome />);
    WKApp.route.register('/meeting/quick', () => <QuickSetup />);
    WKApp.route.register('/meeting/join', (param: { meetingNumber?: string; linkToken?: string }) => {
      const source: AdmissionSource = param?.linkToken ? 'link' : 'number';
      return <JoinFlow source={source} meetingNumber={param?.meetingNumber} linkToken={param?.linkToken} deviceIdHash={deviceIdHash()} />;
    });

    WKApp.menus.register(
      'meeting',
      () => {
        if (!isMeetingFeatureEnabled()) return undefined;
        return new Menus('meeting', '/meeting', translate('meeting.menu.title'), <MeetingMenuIcon />, <MeetingMenuIcon active />);
      },
      4003,
    );
  }
}
