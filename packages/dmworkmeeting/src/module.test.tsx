import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingModule, isMeetingFeatureEnabled } from './module';
import { WKApp, __registered, __resetWKApp } from './__mocks__/dmworkBase';

beforeEach(() => __resetWKApp());

describe('feature flag gating (#5, §14)', () => {
  it('is fail-safe: default OFF when config is absent', () => {
    (WKApp as unknown as { config?: unknown }).config = undefined;
    expect(isMeetingFeatureEnabled()).toBe(false);
  });

  it('is OFF unless explicitly true', () => {
    WKApp.config = {} as { meetingFeatureEnabled?: boolean };
    expect(isMeetingFeatureEnabled()).toBe(false);
    WKApp.config = { meetingFeatureEnabled: false };
    expect(isMeetingFeatureEnabled()).toBe(false);
    WKApp.config = { meetingFeatureEnabled: true };
    expect(isMeetingFeatureEnabled()).toBe(true);
  });

  it('when OFF, init registers NEITHER routes NOR menu', () => {
    WKApp.config = { meetingFeatureEnabled: false };
    new MeetingModule().init();
    expect(__registered.routes).toHaveLength(0);
    expect(__registered.menus).toHaveLength(0);
  });

  it('when ON, init registers the single /meeting route and menu', () => {
    WKApp.config = { meetingFeatureEnabled: true };
    new MeetingModule().init();
    // Only the menu route is registered; MeetingRoot owns sub-view routing.
    expect(__registered.routes).toEqual(['/meeting']);
    expect(__registered.menus).toContain('meeting');
  });
});
