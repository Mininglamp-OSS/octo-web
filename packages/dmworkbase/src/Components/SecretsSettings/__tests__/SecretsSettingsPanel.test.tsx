/**
 * @vitest-environment jsdom
 *
 * SecretsSettingsPanel tests — focus on the one-shot deep-link prefill guard
 * (codex review P2): a pasted plaintext secret must NOT leak into a later manual
 * "+ Add" create in the same mounted panel.
 *
 * React 17 + ReactDOM.render workaround (testing-library pulls react-dom@18).
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../Service/SecretsService', async () => {
  const actual = await vi.importActual<any>('../../../Service/SecretsService');
  return {
    ...actual,
    default: {
      ...actual.default,
      shared: { list: (...a: any[]) => hoisted.list(...a) },
      normalizeName: actual.default.normalizeName,
      normalizeList: actual.default.normalizeList,
      maskFromLast4: actual.default.maskFromLast4,
    },
  };
});

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
  Spin: () => React.createElement('span', null, 'spin'),
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconPlus: () => React.createElement('span'),
  IconKey: () => React.createElement('span'),
  IconCopy: () => React.createElement('span'),
  IconEdit: () => React.createElement('span'),
  IconDelete: () => React.createElement('span'),
  IconRefresh: () => React.createElement('span'),
}));

vi.mock('../../WKModal', () => ({
  default: ({ children, visible }: any) =>
    visible ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
  wkConfirm: vi.fn(),
  __esModule: true,
}));

vi.mock('../../WKButton', () => ({
  default: ({ children, onClick, disabled, icon }: any) =>
    React.createElement('button', { onClick, disabled }, icon, children),
  __esModule: true,
}));

// Capture props passed into the child edit modal without rendering its internals.
const editModalProps: any[] = [];
vi.mock('../SecretEditModal', () => ({
  default: (props: any) => {
    editModalProps.push(props);
    return React.createElement('div', { 'data-testid': 'edit-modal' });
  },
  __esModule: true,
}));

import SecretsSettingsPanel from '../SecretsSettingsPanel';

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  hoisted.list.mockReset().mockResolvedValue([]);
  editModalProps.length = 0;
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

describe('SecretsSettingsPanel deep-link prefill (one-shot)', () => {
  it('passes prefill to the initial deep-link create modal', async () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretsSettingsPanel, {
          onClose: vi.fn(),
          initialCreate: true,
          prefillName: 'Claude',
          prefillValue: 'sk-abcdefghijklmnop',
        }),
        container
      );
    });
    await flush();
    const last = editModalProps[editModalProps.length - 1];
    expect(last.prefillValue).toBe('sk-abcdefghijklmnop');
    expect(last.prefillName).toBe('Claude');
  });

  it('does NOT reuse the pasted secret for a later manual "+ Add"', async () => {
    act(() => {
      ReactDOM.render(
        React.createElement(SecretsSettingsPanel, {
          onClose: vi.fn(),
          initialCreate: true,
          prefillValue: 'sk-abcdefghijklmnop',
        }),
        container
      );
    });
    await flush();

    // Simulate closing the initial dialog, then clicking "+ Add secret" again.
    // The header add button is the first button rendered in the panel.
    const addBtn = container.querySelector('button') as HTMLButtonElement;
    act(() => { addBtn.click(); });
    await flush();

    const last = editModalProps[editModalProps.length - 1];
    expect(last.prefillValue).toBeUndefined();
  });
});
