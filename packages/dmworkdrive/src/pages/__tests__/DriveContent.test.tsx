import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps; stub to shells. Button forwards its
// text/aria-label so we can find the gated entries by name.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, disabled, ...rest }: any) =>
    r.createElement('button', { onClick, disabled, 'aria-label': rest['aria-label'] }, icon, children);
  const Spin = () => r.createElement('div', { className: 'spin' });
  const Modal: any = ({ visible, children }: any) => (visible ? r.createElement('div', null, children) : null);
  Modal.confirm = vi.fn();
  return { Button, Spin, Modal };
});

// UploadButton renders a labeled shell so the test can assert its (gated) presence.
vi.mock('../../ui/UploadButton', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  return { default: () => r.createElement('button', { 'aria-label': 'upload' }, 'upload') };
});

// Children unrelated to toolbar gating — inert shells.
vi.mock('../../ui/Breadcrumb', () => ({ default: () => null }));
vi.mock('../../ui/FileList', () => ({ default: () => null }));
vi.mock('../../ui/NameInputModal', () => ({ default: () => null }));
vi.mock('../../ui/MoveModal', () => ({ default: () => null }));
vi.mock('../../ui/UploadProgress', () => ({ default: () => null }));
vi.mock('../../ui/MountDocsModal', () => ({ default: () => null }));
vi.mock('../../ui/ShareModal', () => ({ default: () => null }));
vi.mock('../../ui/InviteModal', () => ({ default: () => null }));
vi.mock('../../ui/MemberModal', () => ({ default: () => null }));
vi.mock('../../utils/toast', () => ({ Toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/download', () => ({ triggerBrowserDownload: vi.fn() }));

vi.mock('../../hooks/useFileList', () => ({ useFileList: vi.fn() }));
vi.mock('../../hooks/useDriveOps', () => ({ useDriveOps: vi.fn() }));
vi.mock('../../hooks/useUpload', () => ({ useUpload: vi.fn() }));
vi.mock('../../hooks/useMembers', () => ({ useMembers: vi.fn() }));

// The real DriveVM extends ProviderListener from @octo/base (a jsdom landmine
// stubbed away in this suite, so the class can't be instantiated). We don't
// need its machinery — mock useDriveVM to a no-op passthrough and drive the
// pane with a plain fake vm exposing only the fields DriveContent reads.
vi.mock('../DriveVM', () => ({
  DriveVM: class {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useDriveVM: (vm: any) => vm,
}));

import { useFileList } from '../../hooks/useFileList';
import { useDriveOps } from '../../hooks/useDriveOps';
import { useUpload } from '../../hooks/useUpload';
import { useMembers } from '../../hooks/useMembers';
import DriveContent from '../DriveContent';
import type { Space } from '../../bridge/types';

function space(id: string, type: 'personal' | 'shared'): Space {
  return {
    id,
    type,
    name: id,
    super_admin_uid: 'sa',
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  };
}

/** Minimal fake DriveVM exposing only the fields DriveContent reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function vmWith(active: Space): any {
  return {
    activeSpaceId: active.id,
    currentParentId: 0,
    activeSpace: active,
    path: [{ id: 0, name: active.name }],
    spacesLoading: false,
    enterFolder: vi.fn(),
    navigateTo: vi.fn(),
  };
}

type Caps = Partial<Pick<ReturnType<typeof useMembers>, 'canUpload' | 'canEdit' | 'canDownload' | 'canShare' | 'canManage'>>;

/** Stub useMembers with an explicit capability set (as a shared-space role would yield). */
function stubMembers(caps: Caps = {}) {
  vi.mocked(useMembers).mockReturnValue({
    members: [],
    loading: false,
    busyUid: null,
    currentUid: 'test-uid',
    myRole: 'uploader_downloader',
    superAdminUid: 'sa',
    canDownload: !!caps.canDownload,
    canUpload: !!caps.canUpload,
    canShare: !!caps.canShare,
    canEdit: !!caps.canEdit,
    canManage: !!caps.canManage,
    canGrantAdmin: false,
    reload: vi.fn(),
    updateRole: vi.fn(),
    remove: vi.fn(),
  });
}

beforeEach(() => {
  vi.mocked(useMembers).mockReset();
  vi.mocked(useFileList).mockReturnValue({ entries: [], loading: false, error: null, reload: vi.fn() });
  vi.mocked(useDriveOps).mockReturnValue({
    busy: false,
    createFolder: vi.fn(),
    renameEntry: vi.fn(),
    moveEntry: vi.fn(),
    copyEntry: vi.fn(),
    deleteEntry: vi.fn(),
  } as ReturnType<typeof useDriveOps>);
  vi.mocked(useUpload).mockReturnValue({ items: [], addFiles: vi.fn(), retry: vi.fn(), dismiss: vi.fn() } as ReturnType<typeof useUpload>);
});

const UPLOAD = 'upload';
const NEW_FOLDER = 'drive.file.newFolder';
const MOUNT = 'drive.mount.title';
const INVITE = 'drive.invite.title';
const MEMBER = 'drive.member.title';

describe('DriveContent toolbar gating', () => {
  it('admin+ (canManage): shows upload, edit entries, invite and member management', async () => {
    stubMembers({ canUpload: true, canEdit: true, canDownload: true, canShare: true, canManage: true });
    const { queryByRole } = render(<DriveContent vm={vmWith(space('sh', 'shared'))} />);
    await waitFor(() => expect(queryByRole('button', { name: INVITE })).not.toBeNull());
    expect(queryByRole('button', { name: MEMBER })).not.toBeNull();
    expect(queryByRole('button', { name: UPLOAD })).not.toBeNull();
    expect(queryByRole('button', { name: NEW_FOLDER })).not.toBeNull();
    expect(queryByRole('button', { name: MOUNT })).not.toBeNull();
  });

  it('editor (canEdit, not canManage): shows upload + edit entries, hides invite/member', async () => {
    stubMembers({ canUpload: true, canEdit: true, canDownload: true, canShare: true, canManage: false });
    const { queryByRole } = render(<DriveContent vm={vmWith(space('sh', 'shared'))} />);
    await waitFor(() => expect(queryByRole('button', { name: NEW_FOLDER })).not.toBeNull());
    expect(queryByRole('button', { name: MOUNT })).not.toBeNull();
    expect(queryByRole('button', { name: UPLOAD })).not.toBeNull();
    expect(queryByRole('button', { name: INVITE })).toBeNull();
    expect(queryByRole('button', { name: MEMBER })).toBeNull();
  });

  it('uploader_downloader (canUpload, not canEdit): shows upload + add-doc; hides folder/invite/member', async () => {
    stubMembers({ canUpload: true, canEdit: false, canDownload: true, canShare: true, canManage: false });
    const { queryByRole } = render(<DriveContent vm={vmWith(space('sh', 'shared'))} />);
    await waitFor(() => expect(queryByRole('button', { name: UPLOAD })).not.toBeNull());
    expect(queryByRole('button', { name: MOUNT })).not.toBeNull(); // add-doc is uploader_downloader+
    expect(queryByRole('button', { name: NEW_FOLDER })).toBeNull();
    expect(queryByRole('button', { name: INVITE })).toBeNull();
    expect(queryByRole('button', { name: MEMBER })).toBeNull();
  });

  it('downloader (no upload/edit/manage): shows no toolbar action buttons', async () => {
    stubMembers({ canUpload: false, canEdit: false, canDownload: true, canShare: true, canManage: false });
    const { queryByRole } = render(<DriveContent vm={vmWith(space('sh', 'shared'))} />);
    // give the effect a tick via a stable element in the header
    await waitFor(() => expect(document.querySelector('.drive-main__actions')).not.toBeNull());
    expect(queryByRole('button', { name: UPLOAD })).toBeNull();
    expect(queryByRole('button', { name: NEW_FOLDER })).toBeNull();
    expect(queryByRole('button', { name: MOUNT })).toBeNull();
    expect(queryByRole('button', { name: INVITE })).toBeNull();
    expect(queryByRole('button', { name: MEMBER })).toBeNull();
  });

  it('personal space: owner sees upload + edit entries (no membership fetch), no invite/member', async () => {
    stubMembers({}); // useMembers returns no caps; personal-space override grants content ops
    const { queryByRole } = render(<DriveContent vm={vmWith(space('p', 'personal'))} />);
    await waitFor(() => expect(queryByRole('button', { name: NEW_FOLDER })).not.toBeNull());
    expect(queryByRole('button', { name: UPLOAD })).not.toBeNull();
    expect(queryByRole('button', { name: MOUNT })).not.toBeNull();
    expect(queryByRole('button', { name: INVITE })).toBeNull();
    expect(queryByRole('button', { name: MEMBER })).toBeNull();
  });
});
