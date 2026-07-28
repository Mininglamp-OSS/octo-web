import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ShareModal from './index';
import type { DriveEntry } from '../../bridge/types';

// WeCom-style one-shot share modal.
//
// The `doc` flow is fully deterministic in Storybook: it builds the doc's
// `/d/:docId` address purely on the frontend (no drive backend) and shows the
// permission-fallback notice. The `blob` flow calls the drive share API
// (useShare → ensure), which has no backend here, so its happy path is covered
// by unit tests; the modal chrome it renders is the same branch shown below.
const docEntry: DriveEntry = {
  id: 1,
  space_id: 'sp-1',
  parent_id: 0,
  name: '季度规划.doc',
  is_folder: false,
  type: 'doc',
  ref_id: 'doc-abc123',
  size: 0,
  source: 'user-mount',
  owner_uid: 'u-1',
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z',
};

const meta: Meta<typeof ShareModal> = {
  title: 'Drive/ShareModal',
  component: ShareModal,
  tags: ['autodocs'],
  args: { visible: true, onClose: () => {} },
};

export default meta;
type Story = StoryObj<typeof ShareModal>;

/** Online-doc share: generates the /d/:docId link + permission-fallback notice. */
export const Doc: Story = {
  args: { entry: docEntry },
};
