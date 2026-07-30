import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Breadcrumb from './index';

const meta: Meta<typeof Breadcrumb> = {
  title: 'Drive/Breadcrumb',
  component: Breadcrumb,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ padding: 16, background: 'var(--wk-bg-elevated, #fff)' }}>
        <Story />
      </div>
    ),
  ],
  args: { onNavigate: () => {} },
};

export default meta;
type Story = StoryObj<typeof Breadcrumb>;

/** Space root only (single, non-clickable crumb). */
export const Root: Story = {
  args: { path: [{ id: 0, name: '全部文件' }] },
};

/** Nested path — every crumb but the last is clickable. */
export const Nested: Story = {
  args: {
    path: [
      { id: 0, name: '全部文件' },
      { id: 10, name: '产品设计' },
      { id: 22, name: '2026 Q3' },
      { id: 41, name: '评审稿' },
    ],
  },
};
