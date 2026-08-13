import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import Button from './index'

const meta: Meta<typeof Button> = {
  title: 'Octo UI/Button',
  component: Button,
  parameters: {
    docs: {
      description: {
        component: 'Interactive base button for shared Octo UI workflows.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'radio',
      options: ['primary', 'secondary', 'ghost', 'danger'],
    },
    size: {
      control: 'radio',
      options: ['md', 'sm'],
    },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    iconOnly: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Button>

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', gap: 'var(--wk-sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
    {children}
  </div>
)

export const Playground: Story = {
  args: {
    children: 'Confirm',
    variant: 'primary',
    size: 'md',
  },
}

export const Variants: Story = {
  render: () => (
    <Row>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </Row>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Row>
      <Button variant="primary" size="md">Medium</Button>
      <Button variant="primary" size="sm">Small</Button>
      <Button variant="secondary" size="md">Medium</Button>
      <Button variant="secondary" size="sm">Small</Button>
    </Row>
  ),
}

export const States: Story = {
  render: () => (
    <Row>
      <Button variant="primary" disabled>Disabled</Button>
      <Button variant="secondary" disabled>Disabled</Button>
      <Button variant="primary" loading>Loading</Button>
      <Button variant="secondary" loading>Loading</Button>
    </Row>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Row>
      <Button variant="primary" icon={<span>+</span>}>Create</Button>
      <Button variant="secondary" icon={<span>i</span>}>Details</Button>
      <Button variant="ghost" icon={<span>?</span>}>Help</Button>
    </Row>
  ),
}

export const IconOnly: Story = {
  render: () => (
    <Row>
      <Button variant="ghost" iconOnly icon={<span>x</span>} aria-label="Close" />
      <Button variant="secondary" iconOnly icon={<span>...</span>} aria-label="More actions" />
      <Button variant="primary" iconOnly icon={<span>+</span>} aria-label="Create" size="sm" />
    </Row>
  ),
}

export const EdgeCases: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--wk-sp-3)', maxWidth: 'min(100%, 420px)' }}>
      <Button variant="secondary">A button with a longer label that stays on one line</Button>
      <Button variant="primary" icon={<span>+</span>}>Create shared component</Button>
      <Button variant="danger" loading>Deleting</Button>
    </div>
  ),
}
