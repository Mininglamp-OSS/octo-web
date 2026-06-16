/**
 * @vitest-environment jsdom
 *
 * VoiceSettingsPanel unit tests.
 *
 * Uses ReactDOM.render + react-dom/test-utils.act because this monorepo's
 * dmworkbase is React 17 but @testing-library/react pulls react-dom@18,
 * causing "Invalid hook call". Same workaround as PersonaCreate.test.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => {
  const updateSetting = vi.fn();
  const acceptVoiceInput = vi.fn().mockResolvedValue(undefined);
  const enableVoiceInput = vi.fn().mockResolvedValue(undefined);
  const disableVoiceInput = vi.fn().mockResolvedValue(undefined);
  const toggleVoiceFeedback = vi.fn().mockResolvedValue(undefined);
  const toastError = vi.fn();
  const noticeMock = vi.fn();
  return { updateSetting, acceptVoiceInput, enableVoiceInput, disableVoiceInput, toggleVoiceFeedback, toastError, noticeMock };
});

let hookReturn: any;

function resetHookReturn() {
  hookReturn = {
    spaceSetting: { voice_input_enabled: 0, voice_feedback_on: 0, voice_feedback_notice_acked: 0 },
    voiceConfig: {
      feedback_url: 'https://fb.test',
      feedback_privacy_url: 'https://privacy.test',
      feedback_user_agreement_url: 'https://agreement.test',
    },
    apiAvailable: true,
    loaded: true,
    updateSetting: hoisted.updateSetting,
  };
}

resetHookReturn();

vi.mock('../../MessageInput/useSpaceFeedbackSetting', () => ({
  default: () => hookReturn,
  toggleVoiceFeedback: (...args: any[]) => hoisted.toggleVoiceFeedback(...args),
  acceptVoiceInput: (...args: any[]) => hoisted.acceptVoiceInput(...args),
  enableVoiceInput: (...args: any[]) => hoisted.enableVoiceInput(...args),
  disableVoiceInput: (...args: any[]) => hoisted.disableVoiceInput(...args),
}));

vi.mock('../../../App', () => ({
  default: { shared: { currentSpaceId: 'space-1' } },
  __esModule: true,
}));

vi.mock('../../WKModal', () => ({
  default: ({ children, visible, onCancel, title }: any) =>
    visible
      ? React.createElement('div', { 'data-testid': 'wk-modal' },
          React.createElement('div', { 'data-testid': 'modal-title' }, title),
          React.createElement('button', { 'data-testid': 'modal-close', onClick: onCancel }, 'close'),
          children,
        )
      : null,
  __esModule: true,
}));

vi.mock('../../WKButton', () => ({
  default: ({ children, onClick, disabled }: any) =>
    React.createElement('button', { onClick, disabled }, children),
  __esModule: true,
}));

vi.mock('../../MessageInput/VoiceFeedbackNotice', () => ({
  default: (props: any) => {
    hoisted.noticeMock(props);
    return React.createElement('div', { 'data-testid': 'voice-feedback-notice' },
      React.createElement('button', { 'data-testid': 'notice-accept', onClick: () => props.onAccept(false) }, 'accept'),
      React.createElement('button', { 'data-testid': 'notice-accept-feedback', onClick: () => props.onAccept(true) }, 'accept-feedback'),
      React.createElement('button', { 'data-testid': 'notice-cancel', onClick: props.onCancel }, 'cancel'),
    );
  },
  __esModule: true,
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Switch: ({ checked, onChange, disabled }: any) =>
    React.createElement('button', {
      'data-testid': 'semi-switch',
      'data-checked': String(!!checked),
      'data-disabled': String(!!disabled),
      onClick: () => { if (!disabled) onChange?.(!checked); },
    }, 'switch'),
  Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
  Toast: { error: (...args: any[]) => hoisted.toastError(...args) },
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconHelpCircle: () => React.createElement('span', null),
}));

import VoiceSettingsPanel from '../VoiceSettingsPanel';

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  resetHookReturn();
  hoisted.updateSetting.mockReset();
  hoisted.acceptVoiceInput.mockReset().mockResolvedValue(undefined);
  hoisted.enableVoiceInput.mockReset().mockResolvedValue(undefined);
  hoisted.disableVoiceInput.mockReset().mockResolvedValue(undefined);
  hoisted.toggleVoiceFeedback.mockReset().mockResolvedValue(undefined);
  hoisted.toastError.mockReset();
  hoisted.noticeMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const renderPanel = async (onClose = vi.fn()) => {
  await act(async () => {
    ReactDOM.render(<VoiceSettingsPanel onClose={onClose} />, container);
  });
  return onClose;
};

describe('VoiceSettingsPanel', () => {
  it('renders voice transcription as the primary row instead of a modal header', async () => {
    await renderPanel();
    expect(container.querySelector('[data-testid="modal-title"]')?.textContent).toBe('');
    expect(container.querySelector('.wk-voice-settings__row--primary')?.textContent).toContain('语音转写');
  });

  it('shows voice transcription label', async () => {
    await renderPanel();
    expect(container.textContent).toContain('语音转写');
  });

  describe('toggle ON → VoiceFeedbackNotice', () => {
    it('shows VoiceFeedbackNotice when toggling on', async () => {
      await renderPanel();
      expect(container.querySelector('[data-testid="voice-feedback-notice"]')).toBeNull();
      const sw = container.querySelector('[data-testid="semi-switch"]') as HTMLElement;
      act(() => { sw.click(); });
      await flush();
      expect(container.querySelector('[data-testid="voice-feedback-notice"]')).not.toBeNull();
    });

    it('passes privacy and agreement URLs to VoiceFeedbackNotice', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      expect(hoisted.noticeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          feedbackPrivacyUrl: 'https://privacy.test',
          feedbackUserAgreementUrl: 'https://agreement.test',
        }),
      );
    });

    it('calls acceptVoiceInput with feedbackOn=false on accept', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      await act(async () => {
        (container.querySelector('[data-testid="notice-accept"]') as HTMLElement).click();
      });
      await flush();
      expect(hoisted.acceptVoiceInput).toHaveBeenCalledWith('space-1', false);
    });

    it('calls acceptVoiceInput with feedbackOn=true when accepted with feedback', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      await act(async () => {
        (container.querySelector('[data-testid="notice-accept-feedback"]') as HTMLElement).click();
      });
      await flush();
      expect(hoisted.acceptVoiceInput).toHaveBeenCalledWith('space-1', true);
    });

    it('hides notice after accept', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      await act(async () => {
        (container.querySelector('[data-testid="notice-accept"]') as HTMLElement).click();
      });
      await flush();
      expect(container.querySelector('[data-testid="voice-feedback-notice"]')).toBeNull();
    });

    it('hides notice on cancel, switch stays OFF', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      act(() => {
        (container.querySelector('[data-testid="notice-cancel"]') as HTMLElement).click();
      });
      expect(container.querySelector('[data-testid="voice-feedback-notice"]')).toBeNull();
      expect(hoisted.acceptVoiceInput).not.toHaveBeenCalled();
    });
  });

  describe('toggle OFF', () => {
    beforeEach(() => {
      hookReturn.spaceSetting = { voice_input_enabled: 1, voice_feedback_on: 1, voice_feedback_notice_acked: 1 };
    });

    it('calls disableVoiceInput', async () => {
      await renderPanel();
      await act(async () => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      expect(hoisted.disableVoiceInput).toHaveBeenCalledWith('space-1');
    });

    it('optimistically updates both voice_input_enabled and voice_feedback_on', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      expect(hoisted.updateSetting).toHaveBeenCalledWith({ voice_input_enabled: 0, voice_feedback_on: 0 });
    });

    it('rolls back both fields on failure', async () => {
      hoisted.disableVoiceInput.mockRejectedValueOnce(new Error('fail'));
      await renderPanel();
      await act(async () => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      expect(hoisted.updateSetting).toHaveBeenCalledWith({ voice_input_enabled: 1, voice_feedback_on: 1 });
    });
  });

  describe('apiAvailable === false', () => {
    beforeEach(() => {
      hookReturn.apiAvailable = false;
    });

    it('shows unavailable warning when loaded', async () => {
      hookReturn.loaded = true;
      await renderPanel();
      expect(container.textContent).toContain('当前服务不可用，无法修改语音设置');
    });

    it('does not show unavailable warning when not loaded', async () => {
      hookReturn.loaded = false;
      await renderPanel();
      expect(container.textContent).not.toContain('当前服务不可用，无法修改语音设置');
    });

    it('disables the voice transcription switch', async () => {
      await renderPanel();
      const sw = container.querySelector('[data-testid="semi-switch"]') as HTMLElement;
      expect(sw.getAttribute('data-disabled')).toBe('true');
    });

    it('does not trigger action when switch clicked while disabled', async () => {
      await renderPanel();
      act(() => {
        (container.querySelector('[data-testid="semi-switch"]') as HTMLElement).click();
      });
      await flush();
      expect(hoisted.enableVoiceInput).not.toHaveBeenCalled();
      expect(hoisted.updateSetting).not.toHaveBeenCalled();
    });
  });

  describe('feedback toggle (toggle 2)', () => {
    it('shows when voice enabled + feedback_url exists', async () => {
      hookReturn.spaceSetting = { voice_input_enabled: 1, voice_feedback_on: 0, voice_feedback_notice_acked: 1 };
      await renderPanel();
      expect(container.textContent).toContain('帮助改进语音识别服务');
    });

    it('hidden when voice disabled', async () => {
      hookReturn.spaceSetting = { voice_input_enabled: 0, voice_feedback_on: 0, voice_feedback_notice_acked: 1 };
      await renderPanel();
      expect(container.textContent).not.toContain('帮助改进语音识别服务');
    });

    it('hidden when no feedback_url', async () => {
      hookReturn.spaceSetting = { voice_input_enabled: 1, voice_feedback_on: 0, voice_feedback_notice_acked: 1 };
      hookReturn.voiceConfig = { feedback_url: '', feedback_privacy_url: '', feedback_user_agreement_url: '' };
      await renderPanel();
      expect(container.textContent).not.toContain('帮助改进语音识别服务');
    });

    it('disabled when apiAvailable is false', async () => {
      hookReturn.spaceSetting = { voice_input_enabled: 1, voice_feedback_on: 0, voice_feedback_notice_acked: 1 };
      hookReturn.apiAvailable = false;
      await renderPanel();
      const switches = container.querySelectorAll('[data-testid="semi-switch"]');
      const feedbackSwitch = switches[1] as HTMLElement;
      expect(feedbackSwitch.getAttribute('data-disabled')).toBe('true');
    });
  });

  describe('privacy/agreement links', () => {
    it('renders links when URLs present', async () => {
      await renderPanel();
      expect(container.textContent).toContain('《Octo个人信息保护政策》');
      expect(container.textContent).toContain('《Octo 用户服务协议》');
    });

    it('hides links when URLs empty', async () => {
      hookReturn.voiceConfig = { feedback_url: 'https://fb.test', feedback_privacy_url: '', feedback_user_agreement_url: '' };
      await renderPanel();
      expect(container.textContent).not.toContain('《Octo个人信息保护政策》');
      expect(container.textContent).not.toContain('《Octo 用户服务协议》');
    });
  });
});
