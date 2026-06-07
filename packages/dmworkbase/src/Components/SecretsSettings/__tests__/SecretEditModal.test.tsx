/**
 * @vitest-environment jsdom
 *
 * SecretEditModal unit tests — core write-only security interaction (YUJ-3539).
 *
 * Uses ReactDOM.render + react-dom/test-utils.act (React 17), same workaround as
 * VoiceSettingsPanel.test (testing-library pulls react-dom@18 → "Invalid hook call").
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../../Service/SecretsService', async () => {
  const actual = await vi.importActual<any>('../../../Service/SecretsService');
  return {
    ...actual,
    default: {
      ...actual.default,
      shared: {
        create: (...a: any[]) => hoisted.create(...a),
        update: (...a: any[]) => hoisted.update(...a),
      },
      normalizeName: actual.default.normalizeName,
    },
  };
});

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: {
    success: (...a: any[]) => hoisted.toastSuccess(...a),
    error: (...a: any[]) => hoisted.toastError(...a),
  },
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconKey: () => React.createElement('span'),
  IconLock: () => React.createElement('span'),
  IconEyeOpened: () => React.createElement('span', null, 'eye'),
  IconEyeClosed: () => React.createElement('span', null, 'eye-off'),
}));

vi.mock('../../WKModal', () => ({
  default: ({ children, visible, footer }: any) =>
    visible
      ? React.createElement('div', { 'data-testid': 'modal' }, children, footer)
      : null,
  wkConfirm: vi.fn(),
  __esModule: true,
}));

vi.mock('../../WKButton', () => ({
  default: ({ children, onClick, disabled }: any) =>
    React.createElement('button', { onClick, disabled }, children),
  __esModule: true,
}));

import SecretEditModal from '../SecretEditModal';

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  hoisted.create.mockReset().mockResolvedValue({});
  hoisted.update.mockReset().mockResolvedValue({});
  hoisted.toastSuccess.mockReset();
  hoisted.toastError.mockReset();
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

function getValueInput(): HTMLInputElement {
  return container.querySelector('.wk-secrets-form__input--value') as HTMLInputElement;
}
function getNameInput(): HTMLInputElement {
  return container.querySelector('.wk-secrets-form__input:not(.wk-secrets-form__input--value)') as HTMLInputElement;
}
function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SecretEditModal (create mode)', () => {
  it('renders an empty, masked (password) value field by default', () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretEditModal, {
          existing: [],
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
        container
      );
    });
    const value = getValueInput();
    expect(value.type).toBe('password');
    expect(value.value).toBe('');
  });

  it('toggles value visibility with the eye button (write-only self-check)', () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretEditModal, {
          existing: [],
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
        container
      );
    });
    expect(getValueInput().type).toBe('password');
    const reveal = container.querySelector('.wk-secrets-form__reveal') as HTMLButtonElement;
    act(() => { reveal.click(); });
    expect(getValueInput().type).toBe('text');
  });

  it('blocks submit on duplicate name (case-insensitive)', () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretEditModal, {
          existing: [
            { secret_id: 'x', display_name: 'Claude', kind: 'llm', created_at: '2026-01-01T00:00:00Z' },
          ],
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
        container
      );
    });
    act(() => { setInput(getNameInput(), 'claude'); });
    act(() => { setInput(getValueInput(), 'sk-abcdefghijklmnop'); });
    expect(container.querySelector('.wk-secrets-form__error')).not.toBeNull();
  });

  it('submits create with name/kind/value and shows success toast', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    act(() => {
      ReactDOM.render(
        React.createElement(SecretEditModal, {
          existing: [],
          onClose,
          onSaved,
        }),
        container
      );
    });
    act(() => { setInput(getNameInput(), '我的 Claude 密钥'); });
    act(() => { setInput(getValueInput(), 'sk-abcdefghijklmnop'); });
    const buttons = Array.from(container.querySelectorAll('button'));
    const saveBtn = buttons[buttons.length - 1];
    await act(async () => { saveBtn.click(); await Promise.resolve(); });
    await flush();
    expect(hoisted.create).toHaveBeenCalledWith({
      display_name: '我的 Claude 密钥',
      kind: 'llm',
      key: 'sk-abcdefghijklmnop',
    });
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('SecretEditModal (edit mode)', () => {
  const secret = {
    secret_id: 'id1',
    display_name: 'Claude',
    kind: 'llm' as const,
    last4: 'wxyz',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('never pre-fills the original value and shows the set-hint', () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretEditModal, {
          secret,
          existing: [secret],
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
        container
      );
    });
    expect(getValueInput().value).toBe('');
    expect(container.querySelector('.wk-secrets-form__hint')?.textContent).toContain('wxyz');
  });

  it('allows rename-only update without sending a new value', async () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretEditModal, {
          secret,
          existing: [secret],
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
        container
      );
    });
    act(() => { setInput(getNameInput(), 'Claude Pro'); });
    const buttons = Array.from(container.querySelectorAll('button'));
    const saveBtn = buttons[buttons.length - 1];
    await act(async () => { saveBtn.click(); await Promise.resolve(); });
    await flush();
    expect(hoisted.update).toHaveBeenCalledWith('id1', { display_name: 'Claude Pro' });
  });
});
