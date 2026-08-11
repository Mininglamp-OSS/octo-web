import React from 'react';
import type { IModule } from '@octo/base';
import { i18n, WKApp, Menus, t as translate } from '@octo/base';
import MeetingRoot from './pages/MeetingRoot';
import enUS from './i18n/en-US.json';
import zhCN from './i18n/zh-CN.json';

/**
 * Top-level feature flag (§14): MEETING_FEATURE_ENABLED. Fail-safe / default
 * OFF — the module registers nothing (neither menu nor routes) unless the flag
 * is explicitly true, so a misconfigured or absent config hides Meeting entirely.
 */
export function isMeetingFeatureEnabled(): boolean {
  return WKApp.config?.meetingFeatureEnabled === true;
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

export class MeetingModule implements IModule {
  id(): string {
    return 'MeetingModule';
  }

  init(): void {
    // i18n namespace is safe to register unconditionally.
    i18n.registerNamespace('meeting', { 'zh-CN': zhCN, 'en-US': enUS });

    // Fail-safe: when the flag is off, register neither routes nor menu.
    if (!isMeetingFeatureEnabled()) return;

    // Single menu route. The shell renders only the menu's routePath component,
    // so MeetingRoot owns all `/meeting/*` sub-view routing (deep links +
    // back/forward) internally — see pages/MeetingRoot.tsx.
    WKApp.route.register('/meeting', () => <MeetingRoot />);

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
