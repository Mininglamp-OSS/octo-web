import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import Checkbox, { CheckboxGroup } from './index'
import type { CheckboxValue } from './types'

const meta: Meta<typeof Checkbox> = {
  title: 'Octo UI/Checkbox',
  component: Checkbox,
  parameters: {
    docs: {
      description: {
        component: 'Semi-based checkbox primitive. Default is 16px; small is 12px for compact Loop-style usage.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['sm', 'md'],
    },
    checked: { control: 'boolean' },
    defaultChecked: { control: 'boolean' },
    disabled: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Checkbox>

const Stack = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gap: '12px', alignItems: 'start' }}>
    {children}
  </div>
)

export const Playground: Story = {
  args: {
    children: 'Receive notifications',
    size: 'md',
  },
}

export const States: Story = {
  render: () => (
    <Stack>
      <Checkbox>Unchecked</Checkbox>
      <Checkbox defaultChecked>Checked</Checkbox>
      <Checkbox indeterminate>Indeterminate</Checkbox>
      <Checkbox disabled>Disabled</Checkbox>
      <Checkbox disabled checked>Checked disabled</Checkbox>
      <Checkbox disabled indeterminate>Indeterminate disabled</Checkbox>
    </Stack>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Stack>
      <Checkbox size="sm">Small checkbox</Checkbox>
      <Checkbox size="sm" defaultChecked>Small checked</Checkbox>
      <Checkbox size="md">Default checkbox</Checkbox>
      <Checkbox size="md" defaultChecked>Default checked</Checkbox>
    </Stack>
  ),
}

export const WithExtra: Story = {
  render: () => (
    <Checkbox
      defaultChecked
      extra="Used for digest emails and push notifications."
    >
      Enable project updates
    </Checkbox>
  ),
}

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = useState(true)

    return (
      <Checkbox checked={checked} onCheckedChange={setChecked}>
        Controlled checkbox: {checked ? 'checked' : 'unchecked'}
      </Checkbox>
    )
  },
}

export const Group: Story = {
  render: () => {
    const [value, setValue] = useState<CheckboxValue[]>(['message'])

    return (
      <CheckboxGroup
        value={value}
        onValueChange={setValue}
        options={[
          { label: 'Message', value: 'message' },
          { label: 'Mention', value: 'mention' },
          { label: 'Task', value: 'task', disabled: true },
        ]}
      />
    )
  },
}

export const LongLabel: Story = {
  render: () => (
    <div style={{ maxWidth: 280 }}>
      <Checkbox extra="Secondary text wraps independently from the main label.">
        A long checkbox label that wraps inside a narrow container without shifting the control
      </Checkbox>
    </div>
  ),
}
