import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps (lottie/tiptap); stub to shells.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Modal = ({ visible, children }: any) => (visible ? r.createElement('div', null, children) : null);
  const Button = ({ icon, children, onClick, disabled, ...rest }: any) =>
    r.createElement('button', { onClick, disabled, 'aria-label': rest['aria-label'] }, icon, children);
  const Spin = () => r.createElement('div', { className: 'spin' });
  const Tag = ({ children }: any) => r.createElement('span', null, children);
  return { Modal, Button, Spin, Tag };
});

vi.mock('../../../hooks/useMountableDocs', () => ({ useMountableDocs: vi.fn() }));

import { useMountableDocs } from '../../../hooks/useMountableDocs';
import MountDocsModal from '../index';
import type { MountableDoc } from '../../../bridge/types';

function doc(id: string, title: string): MountableDoc {
  return {
    doc_id: id,
    title,
    doc_type: 'html',
    owner_id: 'u',
    space_id: 'sp',
    access_type: 'owner',
    granted_role: 3,
    updated_at: '',
  };
}

function stub(over: Partial<ReturnType<typeof useMountableDocs>> = {}) {
  vi.mocked(useMountableDocs).mockReturnValue({
    docs: [],
    loading: false,
    error: null,
    mounting: false,
    reload: vi.fn(),
    mount: vi.fn().mockResolvedValue(true),
    ...over,
  });
}

beforeEach(() => vi.mocked(useMountableDocs).mockReset());

describe('MountDocsModal', () => {
  it('shows the empty hint when there are no candidates', () => {
    stub({ docs: [] });
    const { getByText } = render(
      <MountDocsModal visible spaceId="sp" parentId={0} onClose={() => {}} onMounted={() => {}} />,
    );
    expect(getByText('drive.mount.empty')).toBeInTheDocument();
  });

  it('lists candidate titles', () => {
    stub({ docs: [doc('d1', 'Roadmap')] });
    const { getByText } = render(
      <MountDocsModal visible spaceId="sp" parentId={0} onClose={() => {}} onMounted={() => {}} />,
    );
    expect(getByText('Roadmap')).toBeInTheDocument();
  });

  it('mounts a candidate and calls onMounted on success', async () => {
    const mount = vi.fn().mockResolvedValue(true);
    const onMounted = vi.fn();
    stub({ docs: [doc('d1', 'Roadmap')], mount });
    const { getByRole, click } = render(
      <MountDocsModal visible spaceId="sp" parentId={5} onClose={() => {}} onMounted={onMounted} />,
    );
    click(getByRole('button', { name: 'drive.mount.add' }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    expect(mount.mock.calls[0][0].doc_id).toBe('d1');
    await waitFor(() => expect(onMounted).toHaveBeenCalledTimes(1));
  });
});
