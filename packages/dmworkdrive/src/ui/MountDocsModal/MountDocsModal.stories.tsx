import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import MountDocsModal from './index';

// MountDocsModal self-fetches its candidate list via useMountableDocs when
// visible with a space id. In Storybook there's no drive backend, so we render
// with spaceId=null: the hook short-circuits and the modal shows its empty
// state — a deterministic view of the modal chrome without network noise.
const meta: Meta<typeof MountDocsModal> = {
  title: 'Drive/MountDocsModal',
  component: MountDocsModal,
  tags: ['autodocs'],
  args: {
    visible: true,
    spaceId: null,
    parentId: 0,
    onClose: () => {},
    onMounted: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof MountDocsModal>;

/** Empty candidate list (no mountable docs). */
export const Empty: Story = {};
