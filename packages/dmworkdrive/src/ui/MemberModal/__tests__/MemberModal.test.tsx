import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps; stub to shells. Select becomes a
// native <select> so we can assert option sets and fire changes; Popconfirm
// wraps its trigger so a click on the child fires onConfirm.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Modal = ({ visible, children }: any) =>
    visible ? r.createElement('div', null, children) : null;
  const Button = ({ icon, children, onClick, disabled, ...rest }: any) =>
    r.createElement('button', { onClick, disabled, 'aria-label': rest['aria-label'] }, icon, children);
  const Spin = () => r.createElement('div', { className: 'spin' });
  const Tag = ({ children, className }: any) => r.createElement('span', { className }, children);
  const Select = ({ optionList, value, onChange, disabled, className }: any) =>
    r.createElement(
      'select',
      { className, value: value ?? '', disabled, onChange: (e: any) => onChange?.(e.target.value) },
      (optionList || []).map((o: any) => r.createElement('option', { key: o.value, value: o.value }, o.label)),
    );
  const Popconfirm = ({ children, onConfirm }: any) =>
    r.createElement('span', { className: 'popconfirm', onClick: () => onConfirm?.() }, children);
  const Avatar = ({ children, alt }: any) => r.createElement('span', { 'aria-label': alt }, children);
  return { Modal, Button, Spin, Tag, Select, Popconfirm, Avatar };
});

vi.mock('../../../hooks/useMembers', () => ({ useMembers: vi.fn() }));

import { useMembers } from '../../../hooks/useMembers';
import MemberModal from '../index';
import type { Member, DriveRole } from '../../../bridge/types';

const SA = 'uid-sa'; // super_admin / creator
const ME = 'test-uid'; // matches __mocks__ WKApp.loginInfo.uid

function member(uid: string, role: DriveRole): Member {
  return {
    space_id: 'sp',
    uid,
    role,
    granted_by: SA,
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  };
}

function stub(over: Partial<ReturnType<typeof useMembers>> = {}) {
  vi.mocked(useMembers).mockReturnValue({
    members: [],
    loading: false,
    busyUid: null,
    currentUid: ME,
    myRole: 'super_admin',
    superAdminUid: SA,
    canDownload: true,
    canUpload: true,
    canShare: true,
    canEdit: true,
    canManage: true,
    canGrantAdmin: true,
    reload: vi.fn(),
    updateRole: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    ...over,
  });
}

function roleSelect(container: HTMLElement): HTMLSelectElement | null {
  return container.querySelector<HTMLSelectElement>('select.drive-member__role');
}

function selectOptions(container: HTMLElement): string[] {
  const sel = roleSelect(container);
  if (!sel) return [];
  return Array.from(sel.querySelectorAll('option')).map((o) => (o.textContent ?? '').trim());
}

beforeEach(() => vi.mocked(useMembers).mockReset());

describe('MemberModal', () => {
  it('shows the empty hint when there are no members', () => {
    stub({ members: [] });
    const { getByText } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    expect(getByText('drive.member.empty')).toBeInTheDocument();
  });

  it('super_admin can change roles and the admin option is offered', () => {
    stub({
      members: [member(SA, 'super_admin'), member('u1', 'editor')],
      canManage: true,
      canGrantAdmin: true,
    });
    const { container } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    // One editable row (u1); creator row is a static tag.
    expect(roleSelect(container)).not.toBeNull();
    expect(selectOptions(container)).toContain('drive.member.roleAdmin'); // admin option present
  });

  it('a non-super-admin admin can change roles but the admin option is withheld', () => {
    stub({
      members: [member(SA, 'super_admin'), member(ME, 'admin'), member('u1', 'editor')],
      myRole: 'admin',
      canManage: true,
      canGrantAdmin: false,
    });
    const { container } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    expect(roleSelect(container)).not.toBeNull(); // u1 is editable
    expect(selectOptions(container)).not.toContain('drive.member.roleAdmin'); // admin option withheld
  });

  it('a read-only member sees roles as static tags with no controls', () => {
    stub({
      members: [member(SA, 'super_admin'), member(ME, 'editor'), member('u1', 'downloader')],
      myRole: 'editor',
      canManage: false,
      canGrantAdmin: false,
    });
    const { container, queryByRole } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    expect(roleSelect(container)).toBeNull(); // no dropdowns
    expect(queryByRole('button', { name: 'drive.member.remove' })).toBeNull(); // no remove
  });

  it('never makes the creator row or the actor\'s own row editable', () => {
    // super_admin (creator) opening: only "other" members are editable. Here the
    // sole other member is the creator+self set, so no select/remove renders.
    stub({
      members: [member(ME, 'super_admin')], // actor is the creator, alone
      myRole: 'super_admin',
      canManage: true,
      canGrantAdmin: true,
      superAdminUid: ME,
    });
    const { container, queryByRole } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    expect(roleSelect(container)).toBeNull();
    expect(queryByRole('button', { name: 'drive.member.remove' })).toBeNull();
  });

  it('changing a role dropdown calls updateRole with the picked role', async () => {
    const updateRole = vi.fn().mockResolvedValue(true);
    stub({ members: [member(SA, 'super_admin'), member('u1', 'preview_only')], updateRole });
    const { container } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    const sel = roleSelect(container)!;
    const { act } = await import('../../../__tests__/harness');
    act(() => {
      sel.value = 'editor';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(updateRole).toHaveBeenCalledWith('u1', 'editor'));
  });

  it('confirming removal calls remove with the member uid', async () => {
    const remove = vi.fn().mockResolvedValue(true);
    stub({ members: [member(SA, 'super_admin'), member('u1', 'editor')], remove });
    const { getByRole, click } = render(<MemberModal visible spaceId="sp" onClose={() => {}} />);
    click(getByRole('button', { name: 'drive.member.remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u1'));
  });
});
