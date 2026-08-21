import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import Radio, { RadioGroup } from './index'
import type { RadioValue } from './types'

const meta: Meta<typeof Radio> = {
  title: 'Octo UI/Radio',
  component: Radio,
  parameters: {
    docs: {
      description: {
        component: 'Semi-based radio primitive. Selected state uses the Octo text-primary black fill.',
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
  },
}

export default meta
type Story = StoryObj<typeof Radio>

const Stack = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gap: '12px', alignItems: 'start' }}>
    {children}
  </div>
)

export const Playground: Story = {
  args: {
    children: 'Default option',
    size: 'md',
  },
}

export const States: Story = {
  render: () => (
    <Stack>
      <Radio name="states">Unchecked</Radio>
      <Radio name="states" defaultChecked>Checked</Radio>
      <Radio name="states-disabled" disabled>Disabled</Radio>
      <Radio name="states-disabled" disabled checked>Checked disabled</Radio>
    </Stack>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Stack>
      <Radio name="sizes" size="sm">Small radio</Radio>
      <Radio name="sizes" size="md">Medium radio</Radio>
    </Stack>
  ),
}

export const WithExtra: Story = {
  render: () => (
    <Radio
      defaultChecked
      extra="This option will be used as the default selection."
      name="extra"
    >
      Primary option
    </Radio>
  ),
}

export const ControlledGroup: Story = {
  render: () => {
    const [value, setValue] = useState<RadioValue>('manual')

    return (
      <RadioGroup
        value={value}
        onValueChange={setValue}
        options={[
          { label: 'Manual', value: 'manual' },
          { label: 'Automatic', value: 'automatic' },
          { label: 'Disabled', value: 'disabled', disabled: true },
        ]}
      />
    )
  },
}

export const HorizontalGroup: Story = {
  render: () => (
    <RadioGroup
      defaultValue="day"
      direction="horizontal"
      options={[
        { label: 'Day', value: 'day' },
        { label: 'Week', value: 'week' },
        { label: 'Month', value: 'month' },
      ]}
    />
  ),
}

export const LongLabel: Story = {
  render: () => (
    <div style={{ maxWidth: 280 }}>
      <Radio extra="Secondary text wraps independently from the main label." name="long">
        A long radio label that wraps inside a narrow container without shifting the control
      </Radio>
    </div>
  ),
}
