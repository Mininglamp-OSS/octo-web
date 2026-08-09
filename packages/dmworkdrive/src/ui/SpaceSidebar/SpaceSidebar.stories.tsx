import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import SpaceSidebar from './index';
import type { Space } from '../../bridge/types';

const meta: Meta<typeof SpaceSidebar> = {
  title: 'Drive/SpaceSidebar',
  component: SpaceSidebar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ height: 480, display: 'flex', background: 'var(--wk-bg-base, #f5f6f7)' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onSelect: () => {},
    onCreateShared: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SpaceSidebar>;

function space(id: string, name: string, type: Space['type']): Space {
  return {
    id,
    type,
    name,
    super_admin_uid: 'u1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

const personal = space('p1', '个人空间', 'personal');
const shared = [
  space('s1', '产品设计', 'shared'),
  space('s2', '市场活动', 'shared'),
];

/** Personal + shared spaces, personal selected. */
export const Default: Story = {
  args: { personalSpace: personal, sharedSpaces: shared, activeSpaceId: 'p1', loading: false },
};

/** A shared space is active. */
export const SharedActive: Story = {
  args: { personalSpace: personal, sharedSpaces: shared, activeSpaceId: 's1', loading: false },
};

/** No shared spaces yet. */
export const NoShared: Story = {
  args: { personalSpace: personal, sharedSpaces: [], activeSpaceId: 'p1', loading: false },
};

/** Loading state. */
export const Loading: Story = {
  args: { personalSpace: null, sharedSpaces: [], activeSpaceId: null, loading: true },
};
