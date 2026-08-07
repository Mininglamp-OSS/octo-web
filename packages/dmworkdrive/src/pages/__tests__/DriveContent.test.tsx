import React from 'react';
import ReactDOM from 'react-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '../../__tests__/harness';

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
// FileList captures its props so a test can invoke onOpenDoc directly and assert
// on the doc link DriveContent builds (buildDocLink with the doc's real space).
const fileListRef = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../../ui/FileList', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => {
    fileListRef.current = props;
    return null;
  },
}));
vi.mock('../../ui/NameInputModal', () => ({ default: () => null }));
vi.mock('../../ui/MoveModal', () => ({ default: () => null }));
vi.mock('../../ui/UploadProgress', () => ({ default: () => null }));
vi.mock('../../ui/MountDocsModal', () => ({ default: () => null }));
vi.mock('../../ui/ShareModal', () => ({ default: () => null }));
// InviteModal renders a visibility marker so the space-switch reset test can
// observe an open dialog being closed.
vi.mock('../../ui/InviteModal', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { default: ({ visible }: any) => (visible ? r.createElement('div', null, 'INVITE_OPEN') : null) };
});
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
import * as useDropzoneMod from '../../hooks/useDropzone';
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
  vi.mocked(useFileList).mockReturnValue({
    entries: [],
    loading: false,
    loadingMore: false,
    error: null,
    total: null,
    hasMore: false,
    reload: vi.fn(),
    loadMore: vi.fn(),
    loadMoreError: null,
    retryLoadMore: vi.fn(),
    filter: 'all',
    setFilter: vi.fn(),
  });
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

describe('DriveContent — reset modals on space switch (Q8)', () => {
  it('closes an open dialog when activeSpaceId changes, but not on a same-space rerender', async () => {
    stubMembers({ canUpload: true, canEdit: true, canDownload: true, canShare: true, canManage: true });
    const r = render(<DriveContent vm={vmWith(space('A', 'shared'))} />);
    await waitFor(() => expect(r.queryByRole('button', { name: INVITE })).not.toBeNull());

    // Open the invite dialog in space A.
    r.click(r.getByRole('button', { name: INVITE }));
    expect(r.queryByText('INVITE_OPEN')).not.toBeNull();

    // Re-render with the SAME space id — the reset effect must NOT fire.
    act(() => {
      ReactDOM.render(<DriveContent vm={vmWith(space('A', 'shared'))} />, r.container);
    });
    expect(r.queryByText('INVITE_OPEN')).not.toBeNull();

    // Switch to space B — the effect clears the stale open dialog.
    act(() => {
      ReactDOM.render(<DriveContent vm={vmWith(space('B', 'shared'))} />, r.container);
    });
    expect(r.queryByText('INVITE_OPEN')).toBeNull();
  });
});

describe('DriveContent — open doc builds the canonical no-sp link (Phase-1 remove-`sp`, design §5.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function docEntry(over: Record<string, unknown>): any {
    return {
      id: 5,
      space_id: 'mountSpace',
      parent_id: 0,
      name: 'design.doc',
      is_folder: false,
      type: 'doc',
      ref_id: 'doc-9',
      size: 0,
      source: 'user-mount',
      owner_uid: 'u',
      created_at: '',
      updated_at: '',
      ...over,
    };
  }

  it('opens the bare /d/:docId (no ?sp) even when the doc carries its real space', async () => {
    stubMembers({ canDownload: true });
    // FileList only renders when entries is non-empty (empty → EmptyState),
    // so seed one entry to give the FileList ref something to capture.
    vi.mocked(useFileList).mockReturnValue({
      entries: [{ id: 999 } as unknown as never],
      loading: false,
      loadingMore: false,
      error: null,
      total: 1,
      hasMore: false,
      reload: vi.fn(),
      loadMore: vi.fn(),
      loadMoreError: null,
      retryLoadMore: vi.fn(),
      filter: 'all',
      setFilter: vi.fn(),
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<DriveContent vm={vmWith(space('mountSpace', 'shared'))} />);
    await waitFor(() => expect(fileListRef.current).not.toBeNull());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fileListRef.current!.onOpenDoc as any)(docEntry({ doc_space_id: 'realDocSpace' }));
    // Phase-1: the doc's Space is resolved server-side from the docId by the open-context reader, so
    // the link carries no `?sp` — doc_space_id is accepted-but-ignored by buildDocLink.
    expect(openSpy).toHaveBeenCalledWith(
      'https://test.local/d/doc-9',
      '_blank',
      'noopener,noreferrer',
    );
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).not.toContain('sp=');
    expect(url).not.toContain('realDocSpace');
    openSpy.mockRestore();
  });

  it('omits sp and never falls back to the drive mount space when doc_space_id is absent', async () => {
    stubMembers({ canDownload: true });
    // See note above — seed one entry so FileList (not EmptyState) renders.
    vi.mocked(useFileList).mockReturnValue({
      entries: [{ id: 999 } as unknown as never],
      loading: false,
      loadingMore: false,
      error: null,
      total: 1,
      hasMore: false,
      reload: vi.fn(),
      loadMore: vi.fn(),
      loadMoreError: null,
      retryLoadMore: vi.fn(),
      filter: 'all',
      setFilter: vi.fn(),
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<DriveContent vm={vmWith(space('mountSpace', 'shared'))} />);
    await waitFor(() => expect(fileListRef.current).not.toBeNull());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fileListRef.current!.onOpenDoc as any)(docEntry({}));
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://test.local/d/doc-9');
    expect(url).not.toContain('sp=');
    expect(url).not.toContain('mountSpace');
    openSpy.mockRestore();
  });

  it('passes disabled=false to useDropzone when the user canUpload (personal space)', () => {
    // Bot review flagged: `disabled: !canUploadRef.current` left the
    // dropzone permanently disabled because canUploadRef was seeded false
    // and the effect that updated it fired AFTER useDropzone snapshotted
    // its initial disabledRef. Fix hoists canUpload above useDropzone and
    // passes the real boolean. This test asserts the hook is invoked with
    // disabled=false on a canUpload user's first render.
    stubMembers({});
    const useDropzoneSpy = vi.spyOn(useDropzoneMod, 'useDropzone');
    render(<DriveContent vm={vmWith(space('sp-personal', 'personal'))} />);
    expect(useDropzoneSpy).toHaveBeenCalled();
    // Last invocation (React 18 double-invoke friendly).
    const lastCall = useDropzoneSpy.mock.calls[useDropzoneSpy.mock.calls.length - 1]!;
    const opts = lastCall[0] as { disabled?: boolean; onDrop: (f: FileList) => void };
    expect(opts.disabled).toBe(false);

    // And the onDrop callback, when it does fire, must route to addFiles.
    // Array.at(-1) needs es2020; this tsconfig targets es2019. Use the
    // length-index idiom that works everywhere.
    const results = vi.mocked(useUpload).mock.results;
    const addFiles = results[results.length - 1]?.value.addFiles;
    expect(addFiles).toBeDefined();
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });
    const fakeList = { length: 1, 0: file, item: () => file } as unknown as FileList;
    opts.onDrop(fakeList);
    expect(addFiles).toHaveBeenCalledWith(fakeList, 'sp-personal', 0);
    useDropzoneSpy.mockRestore();
  });

  it('passes disabled=true to useDropzone when the user lacks canUpload (preview_only shared)', () => {
    stubMembers({ canDownload: true }); // no canUpload
    const useDropzoneSpy = vi.spyOn(useDropzoneMod, 'useDropzone');
    render(<DriveContent vm={vmWith(space('sp-shared', 'shared'))} />);
    const lastCall = useDropzoneSpy.mock.calls[useDropzoneSpy.mock.calls.length - 1]!;
    const opts = lastCall[0] as { disabled?: boolean };
    expect(opts.disabled).toBe(true);
    useDropzoneSpy.mockRestore();
  });
});
