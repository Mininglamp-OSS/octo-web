/**
 * @vitest-environment jsdom
 *
 * NavVoiceSettingsItem unit tests.
 *
 * Uses ReactDOM.render + react-dom/test-utils.act (React 17 compat).
 * See VoiceSettingsPanel.test.tsx header for explanation.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => ({
  ensureVoiceFeedbackLoaded: vi.fn().mockResolvedValue(undefined),
  spaceChangedHandlers: [] as Array<() => void>,
}));

vi.mock('../../../features/voice-input/useSpaceFeedbackSetting', () => ({
  ensureVoiceFeedbackLoaded: (...args: any[]) =>
    hoisted.ensureVoiceFeedbackLoaded(...args),
}));

vi.mock('../../../App', () => ({
  default: {
    shared: { currentSpaceId: 'space-1' },
    mittBus: {
      on: vi.fn((_event: string, handler: () => void) => {
        hoisted.spaceChangedHandlers.push(handler);
      }),
      off: vi.fn(),
    },
  },
  __esModule: true,
}));

vi.mock('../VoiceSettingsPanel', () => ({
  default: ({ onClose }: any) =>
    React.createElement('div', { 'data-testid': 'voice-settings-panel' },
      React.createElement('button', { onClick: onClose }, 'close'),
    ),
  __esModule: true,
}));

import NavVoiceSettingsItem from '../NavVoiceSettingsItem';
import WKApp from '../../../App';

let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.ensureVoiceFeedbackLoaded.mockResolvedValue(undefined);
  hoisted.spaceChangedHandlers.length = 0;
  WKApp.shared.currentSpaceId = 'space-1';
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

const voiceButton = () => Array.from(container.querySelectorAll('button')).find(el => el.textContent?.includes('语音设置')) as HTMLButtonElement | undefined;

describe('NavVoiceSettingsItem', () => {
  it('always renders 语音设置', async () => {
    await act(async () => {
      ReactDOM.render(
        <ul><NavVoiceSettingsItem /></ul>,
        container,
      );
    });
    expect(container.textContent).toContain('语音设置');
  });

  it('opens VoiceSettingsPanel on click', async () => {
    await act(async () => {
      ReactDOM.render(
        <ul><NavVoiceSettingsItem /></ul>,
        container,
      );
    });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).toBeNull();
    const button = voiceButton()!;
    act(() => { button.click(); });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).not.toBeNull();
  });

  it('closes VoiceSettingsPanel via onClose', async () => {
    await act(async () => {
      ReactDOM.render(
        <ul><NavVoiceSettingsItem /></ul>,
        container,
      );
    });
    const button = voiceButton()!;
    act(() => { button.click(); });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).not.toBeNull();
    const closeBtn = container.querySelector('[data-testid="voice-settings-panel"] button')!;
    act(() => { (closeBtn as HTMLElement).click(); });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).toBeNull();
  });

  it('scopes A to B to A loads by generation and mount lifetime', async () => {
    await act(async () => {
      ReactDOM.render(
        <ul><NavVoiceSettingsItem /></ul>,
        container,
      );
    });
    const handler = hoisted.spaceChangedHandlers[0];
    const firstAPredicate = hoisted.ensureVoiceFeedbackLoaded.mock.calls[0][1];

    WKApp.shared.currentSpaceId = 'space-2';
    handler();
    const bPredicate = hoisted.ensureVoiceFeedbackLoaded.mock.calls[1][1];

    WKApp.shared.currentSpaceId = 'space-1';
    handler();
    const latestAPredicate = hoisted.ensureVoiceFeedbackLoaded.mock.calls[2][1];

    expect(firstAPredicate()).toBe(false);
    expect(bPredicate()).toBe(false);
    expect(latestAPredicate()).toBe(true);

    act(() => ReactDOM.unmountComponentAtNode(container));
    expect(latestAPredicate()).toBe(false);
  });
});
