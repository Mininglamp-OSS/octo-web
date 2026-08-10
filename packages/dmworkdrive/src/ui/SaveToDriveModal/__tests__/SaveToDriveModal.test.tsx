import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '../../../__tests__/harness';

// Mock Semi UI: the same jsdom-hostile barrel avoidance MoveModal / FileList
// tests use. We only exercise SaveToDriveModal's own logic (space-list
// filtering by viewer_role, folder navigation, onConfirm shape) — Semi is
// just a rendering shell here.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Modal = ({ visible, title, children, onOk, onCancel, okText, cancelText, okButtonProps }: any) => {
    if (!visible) return null;
    return r.createElement(
      'div',
      { 'data-testid': 'modal', 'aria-label': title },
      children,
      r.createElement(
        'button',
        {
          'data-testid': 'ok',
          onClick: onOk,
          disabled: okButtonProps?.disabled,
        },
        okText,
      ),
      r.createElement('button', { 'data-testid': 'cancel', onClick: onCancel }, cancelText),
    );
  };
  const Spin = () => r.createElement('div', { 'data-testid': 'spin' });
  const Select = ({ value, onChange, optionList }: any) =>
    r.createElement(
      'select',
      {
        'data-testid': 'space-select',
        value: value ?? '',
        onChange: (e: any) => onChange(e.target.value),
      },
      (optionList ?? []).map((opt: any) =>
        r.createElement(
          'option',
          {
            key: opt.value,
            value: opt.value,
            disabled: opt.disabled,
          },
          opt.label,
        ),
      ),
    );
  return { Modal, Spin, Select };
});

// Mock the browse API — folder tree fetches go through this.
vi.mock('../../../api/driveApi', () => ({
  browse: vi.fn(),
}));

// Mock Toast — we don't need to observe it, but the module imports it.
vi.mock('../../../utils/toast', () => ({ Toast: { error: vi.fn(), success: vi.fn() } }));

import * as api from '../../../api/driveApi';
import SaveToDriveModal from '../index';
import type { Space } from '../../../bridge/types';

function space(id: string, type: 'personal' | 'shared', role?: string): Space {
  return {
    id,
    type,
    name: id,
    super_admin_uid: 'sa',
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
    viewer_role: role as any,
  };
}

function q<T extends HTMLElement = HTMLElement>(container: HTMLElement, sel: string): T {
  const el = container.querySelector<T>(sel);
  if (!el) throw new Error(`selector "${sel}" not found`);
  return el;
}

beforeEach(() => {
  vi.mocked(api.browse).mockReset();
  vi.mocked(api.browse).mockResolvedValue({ entries: [], filter: { type: 'all', source: 'all' }, total: 0 } as any);
});

describe('SaveToDriveModal', () => {
  it('disables spaces below uploader_downloader rank', async () => {
    const spaces = [
      space('p', 'personal', 'super_admin'),
      space('s-editor', 'shared', 'editor'),
      space('s-downloader', 'shared', 'downloader'),
      space('s-preview', 'shared', 'preview_only'),
      space('s-unknown', 'shared', ''),
    ];
    const { container } = render(
      <SaveToDriveModal
        visible
        spaces={spaces}
        onConfirm={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
    );
    const select = q<HTMLSelectElement>(container, '[data-testid="space-select"]');
    const options = Array.from(select.querySelectorAll('option'));
    const disabledMap = new Map(options.map((o) => [o.value, o.disabled]));
    expect(disabledMap.get('p')).toBe(false); // super_admin (rank 100) OK
    expect(disabledMap.get('s-editor')).toBe(false); // editor (60) OK
    expect(disabledMap.get('s-downloader')).toBe(true); // downloader (30) < 40
    expect(disabledMap.get('s-preview')).toBe(true); // preview_only (20) < 40
    expect(disabledMap.get('s-unknown')).toBe(false); // unknown role → permissive
  });

  it('confirms with the selected space and root parent when no folder is entered', async () => {
    const spaces = [space('p', 'personal', 'super_admin')];
    const onConfirm = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <SaveToDriveModal visible spaces={spaces} onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    await act(async () => {
      q<HTMLButtonElement>(container, '[data-testid="ok"]').click();
      // Two microtasks so the async onConfirm chain settles inside the click.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledWith('p', 0);
  });

  it('pre-selects the personal space when defaultSpaceId is not uploadable', async () => {
    const spaces = [
      space('p', 'personal', 'super_admin'),
      space('s-downloader', 'shared', 'downloader'),
    ];
    const onConfirm = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <SaveToDriveModal
        visible
        spaces={spaces}
        defaultSpaceId="s-downloader"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      q<HTMLButtonElement>(container, '[data-testid="ok"]').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Fell back to the personal space, not the disabled downloader default.
    expect(onConfirm).toHaveBeenCalledWith('p', 0);
  });

  it('OK button is disabled while there is no uploadable space at all', () => {
    const spaces = [space('s-downloader', 'shared', 'downloader')];
    const { container } = render(
      <SaveToDriveModal
        visible
        spaces={spaces}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const ok = q<HTMLButtonElement>(container, '[data-testid="ok"]');
    expect(ok.disabled).toBe(true);
  });

  it('cancel calls onClose', () => {
    const spaces = [space('p', 'personal', 'super_admin')];
    const onClose = vi.fn();
    const { container } = render(
      <SaveToDriveModal
        visible
        spaces={spaces}
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    q<HTMLButtonElement>(container, '[data-testid="cancel"]').click();
    expect(onClose).toHaveBeenCalled();
  });

  // Regression: cold-start right-click "存到云盘…" before the user has opened
  // Drive this session. `saveMessageToDriveAt` renders the modal with
  // spacesLoading=true while it waits for vm.spaces to arrive; the modal must
  // (a) render (visible), (b) keep Cancel clickable, (c) keep Confirm
  // disabled, (d) NOT render the space Select — that would look like a broken
  // dropdown when spaces=[]. See Jerry-Xin review PR #1322 blocking finding.
  it('renders a loading shell (spacesLoading=true) with Cancel enabled and Confirm disabled', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SaveToDriveModal
        visible
        spaces={[]}
        spacesLoading
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    // Modal itself is rendered.
    expect(container.querySelector('[data-testid="modal"]')).not.toBeNull();
    // Space Select is NOT rendered in the loading shell.
    expect(container.querySelector('[data-testid="space-select"]')).toBeNull();
    // Spinner is rendered.
    expect(container.querySelector('[data-testid="spin"]')).not.toBeNull();
    // Confirm disabled.
    const ok = q<HTMLButtonElement>(container, '[data-testid="ok"]');
    expect(ok.disabled).toBe(true);
    // Cancel still fires onClose.
    q<HTMLButtonElement>(container, '[data-testid="cancel"]').click();
    expect(onClose).toHaveBeenCalled();
  });
});
