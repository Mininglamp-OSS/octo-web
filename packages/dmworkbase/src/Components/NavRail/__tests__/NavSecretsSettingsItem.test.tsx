/**
 * @vitest-environment jsdom
 *
 * NavSecretsSettingsItem tests — deep-link (mittBus wk:open-secrets) behavior:
 *  - opens the panel with prefill from the event
 *  - a second event while mounted remounts the panel with the new payload (P2)
 *  - closing clears the cached plaintext payload (P2)
 *
 * React 17 + ReactDOM.render workaround (testing-library pulls react-dom@18).
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => {
  // Minimal mitt-compatible bus (on/off/emit). Defined in hoisted scope so the
  // vi.mock('../../../App') factory below can safely reference it.
  const handlers: Record<string, Array<(p?: any) => void>> = {};
  const bus = {
    on(type: string, h: (p?: any) => void) {
      (handlers[type] = handlers[type] || []).push(h);
    },
    off(type: string, h: (p?: any) => void) {
      handlers[type] = (handlers[type] || []).filter((x) => x !== h);
    },
    emit(type: string, p?: any) {
      (handlers[type] || []).forEach((h) => h(p));
    },
  };
  return { bus };
});
const bus = hoisted.bus;

vi.mock('../../../App', () => ({
  default: { mittBus: hoisted.bus },
  __esModule: true,
}));

// i18n → I18nProvider statically imports @douyinfe/semi-ui, which transitively
// loads lottie-web (needs a canvas not present in this bare jsdom env). Mock it.
vi.mock('@douyinfe/semi-ui', () => ({
  ConfigProvider: ({ children }: any) => children,
  LocaleProvider: ({ children }: any) => children,
}));

// Capture the props the panel receives across remounts.
const panelProps: any[] = [];
vi.mock('../../SecretsSettings/SecretsSettingsPanel', () => ({
  default: (props: any) => {
    panelProps.push(props);
    return React.createElement(
      'div',
      { 'data-testid': 'panel', 'data-prefill': props.prefillValue ?? '' },
      React.createElement('button', { 'data-testid': 'panel-close', onClick: props.onClose }, 'x')
    );
  },
  __esModule: true,
}));

import NavSecretsSettingsItem from '../NavSecretsSettingsItem';

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  panelProps.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

function render() {
  act(() => {
    ReactDOM.render(React.createElement(NavSecretsSettingsItem), container);
  });
}

describe('NavSecretsSettingsItem deep link', () => {
  it('opens the panel with prefilled value from a wk:open-secrets event', () => {
    render();
    expect(container.querySelector('[data-testid="panel"]')).toBeNull();
    act(() => { bus.emit('wk:open-secrets', { create: true, value: 'sk-ABCDEFGHIJKLMNOP' }); });
    const panel = container.querySelector('[data-testid="panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-prefill')).toBe('sk-ABCDEFGHIJKLMNOP');
  });

  it('remounts with the new payload when a second event arrives while open', () => {
    render();
    act(() => { bus.emit('wk:open-secrets', { create: true, value: 'sk-FIRSTAAAAAAAAAA' }); });
    act(() => { bus.emit('wk:open-secrets', { create: true, value: 'sk-SECONDBBBBBBBBB' }); });
    const panel = container.querySelector('[data-testid="panel"]');
    expect(panel?.getAttribute('data-prefill')).toBe('sk-SECONDBBBBBBBBB');
  });

  it('clears the cached plaintext payload after the panel is closed', () => {
    render();
    act(() => { bus.emit('wk:open-secrets', { create: true, value: 'sk-ABCDEFGHIJKLMNOP' }); });
    act(() => {
      (container.querySelector('[data-testid="panel-close"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="panel"]')).toBeNull();

    // Re-open manually (li click) — must NOT carry the old pasted value.
    panelProps.length = 0;
    act(() => {
      (container.querySelector('li') as HTMLLIElement).click();
    });
    const last = panelProps[panelProps.length - 1];
    expect(last.prefillValue).toBeUndefined();
  });
});
