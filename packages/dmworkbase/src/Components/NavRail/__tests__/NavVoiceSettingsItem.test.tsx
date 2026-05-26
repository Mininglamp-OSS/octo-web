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

vi.mock('../../MessageInput/useSpaceFeedbackSetting', () => ({
  ensureVoiceFeedbackLoaded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../App', () => ({
  default: {
    mittBus: { on: vi.fn(), off: vi.fn() },
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

let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

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
    const li = Array.from(container.querySelectorAll('li')).find(el => el.textContent?.includes('语音设置'))!;
    act(() => { li.click(); });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).not.toBeNull();
  });

  it('closes VoiceSettingsPanel via onClose', async () => {
    await act(async () => {
      ReactDOM.render(
        <ul><NavVoiceSettingsItem /></ul>,
        container,
      );
    });
    const li = Array.from(container.querySelectorAll('li')).find(el => el.textContent?.includes('语音设置'))!;
    act(() => { li.click(); });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).not.toBeNull();
    const closeBtn = container.querySelector('[data-testid="voice-settings-panel"] button')!;
    act(() => { (closeBtn as HTMLElement).click(); });
    expect(container.querySelector('[data-testid="voice-settings-panel"]')).toBeNull();
  });
});
