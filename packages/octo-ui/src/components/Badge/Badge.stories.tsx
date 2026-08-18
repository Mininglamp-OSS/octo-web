import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import Badge from './index'

const meta: Meta<typeof Badge> = {
  title: 'Octo UI/Badge',
  component: Badge,
  parameters: {
    docs: {
      description: {
        component:
          'Generic numeric or short-content badge. Business meaning and placement stay with the caller.',
      },
    },
  },
  argTypes: {
    variant: { control: 'radio', options: ['strong', 'soft'] },
    size: { control: 'radio', options: ['default', 'small'] },
  },
}

export default meta
type Story = StoryObj<typeof Badge>

const Row = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: 'flex',
      gap: 'var(--wk-sp-3)',
      alignItems: 'center',
      flexWrap: 'wrap',
    }}
  >
    {children}
  </div>
)

export const Playground: Story = {
  args: { count: 12, variant: 'strong', size: 'default' },
}

export const Variants: Story = {
  render: () => (
    <Row>
      <Badge count={1} />
      <Badge count={12} />
      <Badge count={128} />
      <Badge count={128} overflowCount={null} />
      <Badge count={12} variant="soft" />
    </Row>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Row>
      <Badge count={8} />
      <Badge count={128} />
      <Badge count={8} size="small" />
      <Badge count={128} size="small" />
    </Row>
  ),
}

export const EdgeCases: Story = {
  render: () => (
    <Row>
      <Badge count={0} showZero />
      <Badge count={99} />
      <Badge count={100} />
      <Badge>NEW</Badge>
    </Row>
  ),
}
