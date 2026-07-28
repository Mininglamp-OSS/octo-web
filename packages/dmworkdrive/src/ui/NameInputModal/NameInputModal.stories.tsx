import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import NameInputModal from './index';

const meta: Meta<typeof NameInputModal> = {
  title: 'Drive/NameInputModal',
  component: NameInputModal,
  tags: ['autodocs'],
  args: {
    visible: true,
    onClose: () => {},
    onSubmit: async () => true,
  },
};

export default meta;
type Story = StoryObj<typeof NameInputModal>;

/** New-folder flavor (empty field). */
export const NewFolder: Story = {
  args: { title: '新建文件夹', placeholder: '请输入文件夹名称' },
};

/** Rename flavor (pre-filled value). */
export const Rename: Story = {
  args: { title: '重命名', initialValue: 'quarterly-report.pdf' },
};

/** Create shared space flavor. */
export const CreateSpace: Story = {
  args: { title: '创建共享空间', placeholder: '请输入空间名称' },
};
