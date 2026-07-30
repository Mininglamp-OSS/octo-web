import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '../../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps; stub the primitives InviteModal +
// its nested OrgPickerModal use. The mocked Modal only renders its OK button
// when an `onOk` is supplied, so the parent InviteModal's Modal (footer=null,
// no onOk) and the child OrgPickerModal's Modal (has onOk) are distinguishable.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Modal = ({ visible, children, onOk, okButtonProps }: any) =>
    visible
      ? r.createElement(
          'div',
          null,
          children,
          onOk
            ? r.createElement(
                'button',
                { 'aria-label': '__ok__', disabled: okButtonProps?.disabled, onClick: onOk },
                'ok',
              )
            : null,
        )
      : null;
  const Input = ({ value, onChange, placeholder }: any) =>
    r.createElement('input', {
      value: value ?? '',
      placeholder,
      onChange: (e: any) => onChange?.(e.target.value),
    });
  const Spin = () => r.createElement('div', { className: 'spin' });
  const Tag = ({ children }: any) => r.createElement('span', null, children);
  const Button = ({ icon, children, onClick, ...rest }: any) =>
    r.createElement('button', { onClick, 'aria-label': rest['aria-label'] }, icon, children);
  const Select = () => r.createElement('div', { className: 'select' });
  const Tabs = ({ children }: any) => r.createElement('div', null, children);
  const TabPane = ({ children }: any) => r.createElement('div', null, children);
  return { Modal, Input, Spin, Tag, Button, Select, Tabs, TabPane };
});

const addMembers = vi.fn();
vi.mock('../../../hooks/useInvite', () => ({
  useInvite: () => ({
    invites: [],
    loading: false,
    creating: false,
    create: vi.fn(),
    revoke: vi.fn(),
    addMembers,
  }),
}));

vi.mock('../../../hooks/useOrgSearch', () => ({ useOrgSearch: vi.fn() }));
vi.mock('../../../hooks/useMembers', () => ({ useMembers: vi.fn() }));

import { useOrgSearch } from '../../../hooks/useOrgSearch';
import { useMembers } from '../../../hooks/useMembers';
import InviteModal from '../index';

beforeEach(() => {
  addMembers.mockReset();
  vi.mocked(useOrgSearch).mockReset();
  vi.mocked(useMembers).mockReset();
  vi.mocked(useOrgSearch).mockImplementation(() => ({
    // The picker roster is the caller's octo-space roster (host-scoped, fetched
    // once via space-changed) — it does NOT vary with the drive spaceId. Cross-
    // space safety comes from clearing selection + closing the picker on switch,
    // not from swapping candidates, so offer a stable roster here.
    candidates: [{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' }],
    loading: false,
    query: '',
    search: vi.fn(),
  }));
  vi.mocked(useMembers).mockReturnValue({
    members: [],
    loading: false,
    busyUid: null,
    currentUid: 'me',
    myRole: 'super_admin',
    superAdminUid: 'me',
    canDownload: true,
    canUpload: true,
    canShare: true,
    canEdit: true,
    canManage: true,
    canGrantAdmin: true,
    reload: vi.fn(),
    updateRole: vi.fn(),
    remove: vi.fn(),
  });
});

/** Drives InviteModal's `visible`/`spaceId` from local state via test buttons. */
function Harness({ initialSpaceId = 'space-A' }: { initialSpaceId?: string }) {
  const [visible, setVisible] = React.useState(true);
  const [spaceId, setSpaceId] = React.useState<string | null>(initialSpaceId);
  return (
    <>
      <button aria-label="__hide__" onClick={() => setVisible(false)}>
        hide
      </button>
      <button aria-label="__show__" onClick={() => setVisible(true)}>
        show
      </button>
      <button aria-label="__toB__" onClick={() => setSpaceId('space-B')}>
        toB
      </button>
      <InviteModal visible={visible} spaceId={spaceId} onClose={() => setVisible(false)} />
    </>
  );
}

describe('InviteModal ↔ OrgPicker cross-space safety', () => {
  it('closes the picker and clears selection on space switch; never submits Space A picks to Space B', () => {
    const { getByRole, queryByRole, click } = render(<Harness />);

    // Open the org picker in Space A and select Alice (u1).
    click(getByRole('button', { name: 'drive.invite.pickMembers' }));
    expect(queryByRole('button', { name: '__ok__' })).not.toBeNull();
    click(getByRole('button', { name: 'Alice' }));
    expect((getByRole('button', { name: '__ok__' }) as HTMLButtonElement).disabled).toBe(false);

    // Switch to Space B: picker must close (orgOpen forced false via the gate).
    click(getByRole('button', { name: '__toB__' }));
    expect(queryByRole('button', { name: '__ok__' })).toBeNull();

    // Reopen after the switch: selection was cleared, so confirm starts disabled
    // and Space A's pick (u1) is not carried over. The roster is the same octo-
    // space roster (host-scoped), so both users stay offered — the anti-leak
    // guarantee is the cleared selection, not a swapped candidate list.
    click(getByRole('button', { name: 'drive.invite.pickMembers' }));
    expect((getByRole('button', { name: '__ok__' }) as HTMLButtonElement).disabled).toBe(true);
    expect(queryByRole('button', { name: 'Bob' })).not.toBeNull();

    // Prove no cross-space leak: pick Bob (u2) in B and confirm.
    click(getByRole('button', { name: 'Bob' }));
    click(getByRole('button', { name: '__ok__' }));
    expect(addMembers).toHaveBeenCalledTimes(1);
    expect(addMembers).toHaveBeenCalledWith(['u2'], 'editor');
    // u1 (Space A's pick) was never submitted.
    for (const call of addMembers.mock.calls) {
      expect(call[0]).not.toContain('u1');
    }
  });

  it('forces the picker shut when the parent modal hides (does not reopen on its own)', () => {
    const { getByRole, queryByRole, click } = render(<Harness />);

    click(getByRole('button', { name: 'drive.invite.pickMembers' }));
    expect(queryByRole('button', { name: '__ok__' })).not.toBeNull();

    click(getByRole('button', { name: '__hide__' }));
    expect(queryByRole('button', { name: '__ok__' })).toBeNull();

    // Re-showing the invite modal must NOT auto-reopen the picker.
    click(getByRole('button', { name: '__show__' }));
    expect(queryByRole('button', { name: '__ok__' })).toBeNull();
  });
});
