import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import FileList from './index';
import type { DriveEntry } from '../../bridge/types';

const meta: Meta<typeof FileList> = {
  title: 'Drive/FileList',
  component: FileList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: 720, padding: 16, background: 'var(--wk-bg-base, #f5f6f7)' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onOpenFolder: () => {},
    onOpenDoc: () => {},
    onRename: () => {},
    onMove: () => {},
    onCopy: () => {},
    onDelete: () => {},
    onShare: () => {},
    onDownload: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof FileList>;

function entry(over: Partial<DriveEntry> & Pick<DriveEntry, 'id' | 'name' | 'type'>): DriveEntry {
  return {
    space_id: 'space-1',
    parent_id: 0,
    is_folder: over.type === 'folder',
    size: 0,
    source: 'user-upload',
    owner_uid: 'u1',
    created_at: '2026-07-20T09:00:00.000Z',
    updated_at: '2026-07-22T14:30:00.000Z',
    ...over,
  };
}

const mixed: DriveEntry[] = [
  entry({ id: 1, name: 'Design assets', type: 'folder' }),
  entry({ id: 2, name: 'Product spec', type: 'doc', source: 'user-mount', ref_id: 'doc-abc' }),
  entry({
    id: 3,
    name: 'quarterly-report.pdf',
    type: 'blob',
    size: 2_483_910,
    content_type: 'application/pdf',
  }),
  entry({
    id: 4,
    name: 'logo.png',
    type: 'blob',
    size: 91_233,
    content_type: 'image/png',
  }),
];

/** Mixed folders / docs / blobs. */
export const Mixed: Story = {
  args: { entries: mixed, loading: false },
};

/** Loading spinner. */
export const Loading: Story = {
  args: { entries: [], loading: true },
};

/** Empty folder. */
export const Empty: Story = {
  args: { entries: [], loading: false },
};

/** Only Type-2 blobs (each row shows the inline download button). */
export const BlobsOnly: Story = {
  args: { entries: mixed.filter((e) => e.type === 'blob'), loading: false },
};
