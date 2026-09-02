import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import Switch from './index'

const meta: Meta<typeof Switch> = {
  title: 'Octo UI/Switch',
  component: Switch,
  parameters: {
    docs: {
      description: {
        component: 'Semi-based switch primitive. Use for immediate on/off settings; do not bind business configuration semantics into the component.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['sm', 'md', 'lg'],
    },
    checked: { control: 'boolean' },
    defaultChecked: { control: 'boolean' },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Switch>

const Stack = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gap: '12px', alignItems: 'center', justifyItems: 'start' }}>
    {children}
  </div>
)

const DarkTheme = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    const previousTheme = document.body.getAttribute('theme-mode')
    document.body.setAttribute('theme-mode', 'dark')
    return () => {
      if (previousTheme) {
        document.body.setAttribute('theme-mode', previousTheme)
      } else {
        document.body.removeAttribute('theme-mode')
      }
    }
  }, [])

  return (
    <div style={{ background: 'var(--octo-ui-bg-surface)', color: 'var(--octo-ui-text-primary)', padding: 16 }}>
      {children}
    </div>
  )
}

export const Playground: Story = {
  args: {
    size: 'md',
    defaultChecked: true,
    'aria-label': 'Enable setting',
  },
}

export const States: Story = {
  render: () => (
    <Stack>
      <Switch aria-label="On" defaultChecked />
      <Switch aria-label="Off" />
      <Switch aria-label="On disabled" checked disabled />
      <Switch aria-label="Off disabled" disabled />
      <Switch aria-label="Loading" loading />
    </Stack>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <Switch aria-label="Large switch" size="lg" defaultChecked />
      <Switch aria-label="Medium switch" size="md" defaultChecked />
      <Switch aria-label="Small switch" size="sm" defaultChecked />
    </div>
  ),
}

export const LoadingSizes: Story = {
  render: () => (
    <Stack>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <Switch aria-label="Large loading switch" size="lg" loading />
        <Switch aria-label="Medium loading switch" size="md" loading />
        <Switch aria-label="Small loading switch" size="sm" loading />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <Switch aria-label="Large checked loading switch" size="lg" checked loading />
        <Switch aria-label="Medium checked loading switch" size="md" checked loading />
        <Switch aria-label="Small checked loading switch" size="sm" checked loading />
      </div>
    </Stack>
  ),
}

export const DarkStates: Story = {
  render: () => (
    <DarkTheme>
      <Stack>
        <Switch aria-label="Dark on" defaultChecked />
        <Switch aria-label="Dark off" />
        <Switch aria-label="Dark on disabled" checked disabled />
        <Switch aria-label="Dark off disabled" disabled />
        <Switch aria-label="Dark loading" loading />
      </Stack>
    </DarkTheme>
  ),
}

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = useState(true)

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Switch
          aria-label="Controlled switch"
          checked={checked}
          onCheckedChange={setChecked}
        />
        <span style={{ fontSize: 14 }}>{checked ? 'Enabled' : 'Disabled'}</span>
      </div>
    )
  },
}

export const SettingRow: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, width: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Join approval</span>
        <Switch aria-label="Join approval" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Message mute</span>
        <Switch aria-label="Message mute" defaultChecked />
      </div>
    </div>
  ),
}
