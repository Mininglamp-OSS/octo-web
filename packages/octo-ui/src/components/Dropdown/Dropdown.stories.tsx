import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button'
import Dropdown from './index'

const meta: Meta<typeof Dropdown> = {
  title: 'Octo UI/Dropdown',
  component: Dropdown,
  parameters: {
    docs: {
      description: {
        component: 'Unified dropdown menu surface backed by Semi positioning and Octo UI menu rows.',
      },
    },
  },
  argTypes: {
    trigger: {
      control: 'radio',
      options: ['click', 'hover', 'focus', 'custom', 'contextMenu'],
    },
    position: {
      control: 'select',
      options: ['bottomLeft', 'bottomRight', 'topLeft', 'topRight', 'bottom', 'top'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Dropdown>

const Icon = () => <span style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
const Chevron = () => <span aria-hidden="true">›</span>

export const Playground: Story = {
  args: {
    trigger: 'click',
    position: 'bottomLeft',
    overlay: (
      <Dropdown.Menu>
        <Dropdown.Item icon={<Icon />} shortcut="⌘R">重命名</Dropdown.Item>
        <Dropdown.Item icon={<Icon />} selected suffix={<Chevron />}>移动到...</Dropdown.Item>
        <Dropdown.Item icon={<Icon />} danger>删除</Dropdown.Item>
      </Dropdown.Menu>
    ),
    children: <Button>打开菜单</Button>,
  },
}

export const States: Story = {
  render: () => (
    <Dropdown
      overlay={
        <Dropdown.Menu>
          <Dropdown.Item icon={<Icon />} shortcut="⌘N">新建对话</Dropdown.Item>
          <Dropdown.Item icon={<Icon />} selected>当前选中</Dropdown.Item>
          <Dropdown.Item icon={<Icon />} disabled>不可用操作</Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item icon={<Icon />} danger>删除对话</Dropdown.Item>
        </Dropdown.Menu>
      }
    >
      <Button>菜单状态</Button>
    </Dropdown>
  ),
}

export const ItemsApi: Story = {
  render: () => (
    <Dropdown
      items={[
        { key: 'all', label: '全部状态', selected: true },
        { key: 'running', label: '生成中' },
        { key: 'failed', label: '失败任务', type: 'danger' },
      ]}
    >
      <Button variant="secondary">状态筛选</Button>
    </Dropdown>
  ),
}

export const HoverTop: Story = {
  render: () => (
    <Dropdown
      trigger="hover"
      position="topRight"
      overlay={
        <Dropdown.Menu width={160}>
          <Dropdown.Item>语音输入</Dropdown.Item>
          <Dropdown.Item disabled>编辑选中文本</Dropdown.Item>
        </Dropdown.Menu>
      }
    >
      <Button variant="secondary">Hover</Button>
    </Dropdown>
  ),
}
