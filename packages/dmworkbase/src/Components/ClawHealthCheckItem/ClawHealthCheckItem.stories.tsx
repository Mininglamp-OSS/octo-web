import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import ClawHealthCheckItem from './ClawHealthCheckItem';

const meta = {
  title: 'Components/ClawHealthCheckItem',
  component: ClawHealthCheckItem,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['success', 'warning', 'error'],
      description: '健康检查项状态',
    },
    label: {
      control: 'text',
      description: '检查项标签',
    },
    value: {
      control: 'text',
      description: '检查项数值',
    },
  },
} satisfies Meta<typeof ClawHealthCheckItem>;

export default meta;
type Story = StoryObj<typeof meta>;

// 默认故事：正常状态
export const Default: Story = {
  args: {
    status: 'success',
    label: 'OpenClaw 进程',
    value: '正常',
  },
};

// 成功状态（绿色）
export const Success: Story = {
  args: {
    status: 'success',
    label: 'Gateway 连接',
    value: '已连接',
  },
};

// 警告状态（黄色）
export const Warning: Story = {
  args: {
    status: 'warning',
    label: '网络连接',
    value: '472.76ms',
  },
};

// 错误状态（红色）
export const Error: Story = {
  args: {
    status: 'error',
    label: '磁盘空间',
    value: '不足 1GB',
  },
};

// 多个状态对比展示
export const MultipleStates: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <ClawHealthCheckItem
        status="success"
        label="Node.js 环境"
        value="v24.11.1"
      />
      <ClawHealthCheckItem
        status="success"
        label="主机架构"
        value="ARM64"
      />
      <ClawHealthCheckItem
        status="warning"
        label="端口可用"
        value="60418"
      />
      <ClawHealthCheckItem
        status="error"
        label="可写磁盘空间"
        value="0.8 GB"
      />
    </div>
  ),
};

// 网格布局展示（模拟实际使用场景）
export const GridLayout: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        maxWidth: '800px',
      }}
    >
      <ClawHealthCheckItem
        status="success"
        label="OpenClaw 进程"
        value="正常"
      />
      <ClawHealthCheckItem
        status="success"
        label="Gateway 连接"
        value="已连接"
      />
      <ClawHealthCheckItem
        status="success"
        label="Node.js 环境"
        value="v24.11.1"
      />
      <ClawHealthCheckItem
        status="success"
        label="主机架构"
        value="ARM64"
      />
      <ClawHealthCheckItem
        status="success"
        label="可写磁盘空间"
        value="68.0 GB"
      />
      <ClawHealthCheckItem
        status="success"
        label="端口可用"
        value="60418"
      />
      <ClawHealthCheckItem
        status="warning"
        label="网络连接"
        value="472.76ms"
      />
    </div>
  ),
};
