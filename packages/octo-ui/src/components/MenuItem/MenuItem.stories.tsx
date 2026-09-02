import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import MenuItem from './index'

const meta: Meta<typeof MenuItem> = {
  title: 'Octo UI/MenuItem',
  component: MenuItem,
  parameters: {
    docs: {
      description: {
        component: 'Base menu row for action menus and list-style menu surfaces.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['default', 'compact'],
    },
    selected: { control: 'boolean' },
    disabled: { control: 'boolean' },
    danger: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof MenuItem>

const Panel = ({ children, width = 240 }: { children: ReactNode; width?: number }) => (
  <div
    style={{
      width,
      overflow: 'hidden',
      background: 'var(--octo-ui-menu-item-bg)',
    }}
  >
    {children}
  </div>
)

const Icon = () => <span style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
const Chevron = () => <span aria-hidden="true">›</span>

export const Playground: Story = {
  args: {
    icon: <Icon />,
    label: '新建对话',
    shortcut: '⌘N',
  },
}

export const States: Story = {
  render: () => (
    <Panel>
      <MenuItem icon={<Icon />} label="新建对话" shortcut="⌘N" />
      <MenuItem icon={<Icon />} label="重命名（hover）" shortcut="⌘R" />
      <MenuItem icon={<Icon />} label="移动到...（selected）" selected suffix={<Chevron />} />
      <MenuItem icon={<Icon />} label="删除对话" danger />
      <MenuItem icon={<Icon />} label="不可用操作" disabled />
    </Panel>
  ),
}

export const Compact: Story = {
  render: () => (
    <Panel width={180}>
      <MenuItem size="compact" label="新建群聊" />
      <MenuItem size="compact" label="重命名" />
      <MenuItem size="compact" label="向上移动" disabled />
      <MenuItem size="compact" label="删除分组" danger />
    </Panel>
  ),
}

export const EdgeCases: Story = {
  render: () => (
    <Panel>
      <MenuItem
        icon={<Icon />}
        label="产品经理最严格的妈妈本尊超长名字演示"
        shortcut="⌘⇧R"
        suffix={<Chevron />}
      />
      <MenuItem label="纯文字项也需要对齐" suffix={<Chevron />} />
    </Panel>
  ),
}
