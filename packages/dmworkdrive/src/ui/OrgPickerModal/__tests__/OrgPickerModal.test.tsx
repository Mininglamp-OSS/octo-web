import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../../__tests__/harness';

vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Modal = ({ visible, children, onOk, okButtonProps }: any) =>
    visible
      ? r.createElement(
          'div',
          null,
          children,
          r.createElement(
            'button',
            { 'aria-label': '__ok__', disabled: okButtonProps?.disabled, onClick: onOk },
            'ok',
          ),
        )
      : null;
  const Input = ({ value, onChange, placeholder }: any) =>
    r.createElement('input', {
      value: value ?? '',
      placeholder,
      onChange: (e: any) => onChange?.(e.target.value),
    });
  const Spin = () => r.createElement('div', { className: 'spin' });
  const Button = ({ children, onClick, ...rest }: any) =>
    r.createElement('button', { onClick, 'aria-label': rest['aria-label'] }, children);
  const Tag = ({ children }: any) => r.createElement('span', null, children);
  return { Modal, Input, Spin, Button, Tag };
});

vi.mock('../../../hooks/useOrgSearch', () => ({ useOrgSearch: vi.fn() }));
vi.mock('../../../hooks/useMembers', () => ({ useMembers: vi.fn() }));

import { useOrgSearch } from '../../../hooks/useOrgSearch';
import { useMembers } from '../../../hooks/useMembers';
import OrgPickerModal from '../index';
import type { OrgCandidate, Member } from '../../../bridge/types';

function stub(candidates: OrgCandidate[], over: Partial<ReturnType<typeof useOrgSearch>> = {}) {
  vi.mocked(useOrgSearch).mockReturnValue({
    candidates,
    loading: false,
    query: '',
    search: vi.fn(),
    error: false,
    retry: vi.fn(),
    ...over,
  });
}

function stubMembers(members: Member[]) {
  // Only `members` is read by OrgPickerModal; the rest satisfy the type.
  vi.mocked(useMembers).mockReturnValue({
    members,
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
}

const member = (uid: string, role: Member['role']): Member => ({
  space_id: 's1',
  uid,
  role,
  granted_by: 'me',
  created_at: '',
  updated_at: '',
});

beforeEach(() => {
  vi.mocked(useOrgSearch).mockReset();
  vi.mocked(useMembers).mockReset();
  stubMembers([]);
});

describe('OrgPickerModal', () => {
  it('renders search candidates', () => {
    stub([{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' }]);
    const { getByText } = render(
      <OrgPickerModal visible onClose={() => {}} onConfirm={() => {}} />,
    );
    expect(getByText('Alice')).toBeInTheDocument();
    expect(getByText('Bob')).toBeInTheDocument();
  });

  it('toggles selection and confirms picked uids', async () => {
    stub([{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' }]);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { getByRole, click } = render(
      <OrgPickerModal visible onClose={onClose} onConfirm={onConfirm} />,
    );
    click(getByRole('button', { name: 'Alice' }));
    click(getByRole('button', { name: '__ok__' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(['u1']));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not confirm with an empty selection', () => {
    stub([{ uid: 'u1', name: 'Alice' }]);
    const onConfirm = vi.fn();
    const { getByRole, click } = render(
      <OrgPickerModal visible onClose={() => {}} onConfirm={onConfirm} />,
    );
    click(getByRole('button', { name: '__ok__' })); // disabled — no-op
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows already-joined members with their role and disables them', () => {
    stub([{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' }]);
    stubMembers([member('u2', 'editor')]);
    const { getByRole, getByText } = render(
      <OrgPickerModal visible onClose={() => {}} onConfirm={() => {}} />,
    );
    // Bob is already a member: shown, role label rendered, and disabled.
    expect(getByText('drive.member.roleEditor')).toBeInTheDocument();
    expect(getByText('drive.org.joined')).toBeInTheDocument();
    expect((getByRole('button', { name: 'Bob' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Alice' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not select a joined member on click (stays unconfirmable)', () => {
    stub([{ uid: 'u2', name: 'Bob' }]);
    stubMembers([member('u2', 'editor')]);
    const onConfirm = vi.fn();
    const { getByRole, click } = render(
      <OrgPickerModal visible onClose={() => {}} onConfirm={onConfirm} />,
    );
    click(getByRole('button', { name: 'Bob' })); // joined — toggle is a no-op
    expect((getByRole('button', { name: '__ok__' }) as HTMLButtonElement).disabled).toBe(true);
    click(getByRole('button', { name: '__ok__' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clears selection and re-searches when the target space changes (no cross-space carry)', () => {
    const search = vi.fn();
    stub([{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' }], { search });

    function Wrapper() {
      const [spaceId, setSpaceId] = React.useState('space-A');
      return (
        <>
          <button aria-label="__switch__" onClick={() => setSpaceId('space-B')}>
            switch
          </button>
          <OrgPickerModal visible spaceId={spaceId} onClose={() => {}} onConfirm={() => {}} />
        </>
      );
    }

    const { getByRole, click } = render(<Wrapper />);
    // Select Alice in Space A → confirm becomes enabled.
    click(getByRole('button', { name: 'Alice' }));
    expect((getByRole('button', { name: '__ok__' }) as HTMLButtonElement).disabled).toBe(false);

    const searchCallsBeforeSwitch = search.mock.calls.length;
    click(getByRole('button', { name: '__switch__' }));

    // Space changed: selection cleared (confirm disabled again) and a fresh
    // empty search fired for the new space rather than keeping Space A results.
    expect((getByRole('button', { name: '__ok__' }) as HTMLButtonElement).disabled).toBe(true);
    expect(search.mock.calls.length).toBeGreaterThan(searchCallsBeforeSwitch);
    expect(search).toHaveBeenLastCalledWith('');
  });

  it('shows an explicit load-failure state with a retry action (not the empty hint)', () => {
    stub([], { error: true });
    const { getByText, queryByText } = render(
      <OrgPickerModal visible onClose={() => {}} onConfirm={() => {}} />,
    );
    expect(getByText('drive.org.loadFailed')).toBeInTheDocument();
    expect(getByText('drive.org.retry')).toBeInTheDocument();
    // A failure must NOT read as an ordinary empty roster / no-match.
    expect(queryByText('drive.org.hint')).toBeNull();
    expect(queryByText('drive.org.noResult')).toBeNull();
  });

  it('clicking retry re-runs the roster load', () => {
    const retry = vi.fn();
    stub([], { error: true, retry });
    const { getByText, click } = render(
      <OrgPickerModal visible onClose={() => {}} onConfirm={() => {}} />,
    );
    // Mounting visible+error already auto-retried once; the button adds one more.
    const before = retry.mock.calls.length;
    click(getByText('drive.org.retry'));
    expect(retry.mock.calls.length).toBe(before + 1);
  });

  it('auto-retries a failed roster when reopened (hidden→visible)', () => {
    const retry = vi.fn();
    const search = vi.fn();
    stub([], { error: true, retry, search });

    function Wrapper() {
      const [visible, setVisible] = React.useState(false);
      return (
        <>
          <button aria-label="__show__" onClick={() => setVisible(true)}>
            show
          </button>
          <OrgPickerModal visible={visible} onClose={() => {}} onConfirm={() => {}} />
        </>
      );
    }

    const { getByRole, click } = render(<Wrapper />);
    expect(retry).not.toHaveBeenCalled();
    click(getByRole('button', { name: '__show__' }));
    // Reopening a failed picker retries the fetch; it does not fall back to a
    // local-only search('') reset.
    expect(retry).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });

  it('never re-fetches a good cache on reopen — only resets the local filter', () => {
    const retry = vi.fn();
    const search = vi.fn();
    stub([{ uid: 'u1', name: 'Alice' }], { error: false, retry, search });

    function Wrapper() {
      const [visible, setVisible] = React.useState(false);
      return (
        <>
          <button aria-label="__show__" onClick={() => setVisible(true)}>
            show
          </button>
          <OrgPickerModal visible={visible} onClose={() => {}} onConfirm={() => {}} />
        </>
      );
    }

    const { getByRole, click } = render(<Wrapper />);
    click(getByRole('button', { name: '__show__' }));
    expect(retry).not.toHaveBeenCalled();
    expect(search).toHaveBeenLastCalledWith('');
  });
});
