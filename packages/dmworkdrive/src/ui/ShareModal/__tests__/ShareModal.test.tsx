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
  writeText.mockReset();
  vi.mocked(useShare).mockReturnValue({
    shares: [],
    loading: false,
    creating: false,
    reload: vi.fn(),
    create: vi.fn(),
    ensure,
    revoke: vi.fn(),
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
});
