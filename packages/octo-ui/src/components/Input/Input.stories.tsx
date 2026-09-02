import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import Input from './index'

const meta: Meta<typeof Input> = {
  title: 'Octo UI/Input',
  component: Input,
  parameters: {
    docs: {
      description: {
        component: 'Unified input controls backed by Semi behavior and styled to the Octo Input spec.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['small', 'default', 'large'],
    },
    status: {
      control: 'radio',
      options: ['default', 'error', 'warning', 'success'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Input>

export const Playground: Story = {
  args: {
    placeholder: '请输入',
  },
}

export const States: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <div>
        <div style={{ margin: '0 0 4px', color: 'var(--octo-ui-text-secondary)', fontSize: 12 }}>默认</div>
        <Input placeholder="请输入" />
      </div>
      <div>
        <div style={{ margin: '0 0 4px', color: 'var(--octo-ui-text-secondary)', fontSize: 12 }}>全圆角·搜索</div>
        <Input.Search placeholder="搜索" />
      </div>
      <div>
        <div style={{ margin: '0 0 4px', color: 'var(--octo-ui-text-secondary)', fontSize: 12 }}>禁用</div>
        <Input disabled placeholder="请输入" />
      </div>
      <div>
        <div style={{ margin: '0 0 4px', color: 'var(--octo-ui-text-secondary)', fontSize: 12 }}>报错</div>
        <Input status="error" defaultValue="内容有误" aria-describedby="input-error-demo" aria-invalid />
        <Input.ErrorMessage id="input-error-demo">请输入正确的内容</Input.ErrorMessage>
      </div>
    </div>
  ),
}

export const TextArea: Story = {
  render: () => {
    const [value, setValue] = useState('')

    return (
      <Input.TextArea
        value={value}
        maxCount={200}
        placeholder="待填"
        autosize={{ minRows: 4, maxRows: 6 }}
        onChange={(next) => setValue(next)}
      />
    )
  },
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 260 }}>
      <Input size="small" placeholder="Small" />
      <Input size="default" placeholder="Default" />
      <Input size="large" placeholder="Large" />
    </div>
  ),
}

export const PrefixSuffix: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 280 }}>
      <Input prefix="https://" suffix=".com" defaultValue="example" />
      <Input.Search showClear defaultValue="Octo UI" placeholder="搜索" />
    </div>
  ),
}
