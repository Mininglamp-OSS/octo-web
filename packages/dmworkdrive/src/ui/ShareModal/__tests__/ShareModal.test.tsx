import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '../../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps; stub to shells.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Modal = ({ visible, title, children }: any) =>
    visible ? r.createElement('div', { role: 'dialog' }, title, children) : null;
  const Button = ({ icon, children, onClick, ...rest }: any) =>
    r.createElement('button', { onClick, 'aria-label': rest['aria-label'] }, icon, children);
  const Input = ({ value }: any) => r.createElement('input', { value: value ?? '', readOnly: true });
  const Spin = () => r.createElement('div', { className: 'spin' });
  return { Modal, Button, Input, Spin };
});

vi.mock('../../../hooks/useShare', () => ({ useShare: vi.fn() }));

import { useShare } from '../../../hooks/useShare';
import ShareModal from '../index';
import type { DriveEntry } from '../../../bridge/types';

const ensure = vi.fn();
const revoke = vi.fn();
const writeText = vi.fn().mockResolvedValue(undefined);

function entry(over: Partial<DriveEntry>): DriveEntry {
  return {
    id: 7,
    space_id: 'sp1',
    parent_id: 0,
    name: 'file',
    is_folder: false,
    type: 'blob',
    size: 10,
    source: 'upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '',
    ...over,
  } as DriveEntry;
}

beforeEach(() => {
  ensure.mockReset();
  revoke.mockReset();
  writeText.mockReset();
  vi.mocked(useShare).mockReturnValue({
    shares: [],
    loading: false,
    creating: false,
    reload: vi.fn(),
    create: vi.fn(),
    ensure,
    revoke,
  });
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('ShareModal (WeCom one-shot)', () => {
  it('blob: auto-generates a download link, shows the download-permission notice, and copies it', async () => {
    ensure.mockResolvedValue({ id: 'sh-blob', file_id: 7, permission: 'download' });
    const { getByText, container, unmount } = render(
      <ShareModal visible entry={entry({ type: 'blob' })} onClose={() => {}} />,
    );
    await waitFor(() => getByText('drive.share.blobGenerated'));
    expect(ensure).toHaveBeenCalledOnce();
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toContain('sh-blob');
    expect(writeText).toHaveBeenCalledWith(input.value);
    unmount();
  });

  it('doc: generates the /d/:docId address with a permission-fallback notice and never mints a drive share', async () => {
    const { getByText, container, unmount } = render(
      <ShareModal visible entry={entry({ type: 'doc', ref_id: 'doc-9' })} onClose={() => {}} />,
    );
    await waitFor(() => getByText('drive.share.docGenerated'));
    getByText('drive.share.docPermissionFallback');
    expect(ensure).not.toHaveBeenCalled();
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toContain('/d/doc-9');
    expect(writeText).toHaveBeenCalledWith(input.value);
    unmount();
  });

  it('blob: offers a revoke action; on success clears the link and shows the revoked state (B3)', async () => {
    ensure.mockResolvedValue({ id: 'sh-blob', file_id: 7, permission: 'download' });
    revoke.mockResolvedValue(true);
    const { getByText, getByRole, click, queryByText, unmount } = render(
      <ShareModal visible entry={entry({ type: 'blob' })} onClose={() => {}} />,
    );
    await waitFor(() => getByText('drive.share.blobGenerated'));
    click(getByRole('button', { name: 'drive.share.revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('sh-blob'));
    // Revoked: the link/copy row is gone, the revoked notice shows.
    await waitFor(() => getByText('drive.share.revoked'));
    expect(queryByText('drive.share.blobGenerated')).toBeNull();
    unmount();
  });

  it('blob: a failed revoke keeps the link (no revoked state) (B3)', async () => {
    ensure.mockResolvedValue({ id: 'sh-blob', file_id: 7, permission: 'download' });
    revoke.mockResolvedValue(false);
    const { getByText, getByRole, click, queryByText, unmount } = render(
      <ShareModal visible entry={entry({ type: 'blob' })} onClose={() => {}} />,
    );
    await waitFor(() => getByText('drive.share.blobGenerated'));
    click(getByRole('button', { name: 'drive.share.revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('sh-blob'));
    expect(queryByText('drive.share.revoked')).toBeNull();
    getByText('drive.share.blobGenerated');
    unmount();
  });

  it('doc: never shows a revoke action (nothing drive-managed to revoke)', async () => {
    const { getByText, queryByRole, unmount } = render(
      <ShareModal visible entry={entry({ type: 'doc', ref_id: 'doc-9' })} onClose={() => {}} />,
    );
    await waitFor(() => getByText('drive.share.docGenerated'));
    expect(queryByRole('button', { name: 'drive.share.revoke' })).toBeNull();
    unmount();
  });

  it('doc: never emits ?sp= even when doc_space_id is present (Phase-1 remove-`sp`, design §5.3)', async () => {
    const { getByText, container, unmount } = render(
      <ShareModal
        visible
        entry={entry({ type: 'doc', ref_id: 'doc-9', space_id: 'sp1', doc_space_id: 'realDocSpace' })}
        onClose={() => {}}
      />,
    );
    await waitFor(() => getByText('drive.share.docGenerated'));
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toContain('/d/doc-9');
    // The doc's Space is now resolved server-side from the docId by the open-context reader, so the
    // ordinary link carries no `?sp` — the doc_space_id is accepted-but-ignored by buildDocLink.
    expect(input.value).not.toContain('sp=');
    expect(input.value).not.toContain('realDocSpace');
    unmount();
  });

  it('doc: omits ?sp= and never falls back to the drive mount space when doc_space_id is absent', async () => {
    const { getByText, container, unmount } = render(
      <ShareModal
        visible
        entry={entry({ type: 'doc', ref_id: 'doc-9', space_id: 'sp1' })}
        onClose={() => {}}
      />,
    );
    await waitFor(() => getByText('drive.share.docGenerated'));
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toContain('/d/doc-9');
    expect(input.value).not.toContain('sp=');
    expect(input.value).not.toContain('sp1');
    unmount();
  });
});
