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

vi.mock('@octo/ui', () => ({
  Button: ({ children, ...props }: any) => React.createElement('button', props, children),
  Modal: ({ children, visible }: any) =>
    visible ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
  modalConfirm: vi.fn(),
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

  it('opens one create editor for a real mouse click', async () => {
    act(() => { ReactDOM.render(React.createElement(SecretsSettingsPanel, { onClose: vi.fn() }), container); });
    await flush();
    const addBtn = container.querySelector('button') as HTMLButtonElement;
    act(() => { addBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
    act(() => { addBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); });
    act(() => { addBtn.click(); });
    await flush();
    expect(editModalProps).toHaveLength(1);
  });

  it('does not open the create editor for a secondary mouse button', async () => {
    act(() => { ReactDOM.render(React.createElement(SecretsSettingsPanel, { onClose: vi.fn() }), container); });
    await flush();
    const addBtn = container.querySelector('button') as HTMLButtonElement;
    act(() => { addBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 })); });
    act(() => { addBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 })); });
    act(() => { addBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })); });
    await flush();
    expect(editModalProps).toHaveLength(0);
  });
});
